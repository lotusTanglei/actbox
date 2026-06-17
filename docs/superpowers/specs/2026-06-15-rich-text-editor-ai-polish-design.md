# 富文本邮件编辑器 + AI 润色 — 设计规格

日期：2026-06-15
关联：原 5 项 UI 改进中的第 4（富文本编辑）、第 5（AI 润色）。前 3 项（红点/字体/邮件正文）已完成。

## 背景与目标

actbox 邮件线已具备：收（IMAP）、发、回复、AI 起草、待办提取、定时拉取、星标/搜索。但**写信/回复正文当前是纯 `<textarea>`**，无富文本、无润色。

目标：把"写"这一环做完整——
1. 用富文本编辑器替换纯文本框，回复/写信支持完整排版；
2. 发送链路真正发 HTML（收件方看到格式）；
3. 新增 AI 润色（预设动作 + 自定义指令），对选区或整篇改写。

## 范围

### In scope
- 富文本编辑器（TipTap v3，**完整**范围）替换 [ComposeMail](src/components/ComposeMail.tsx) 的 `<Textarea>`。
- 发送链路支持 HTML：`MailSender.send` 同时发 text + html；`/api/send`、`/api/draft` 写入 `bodyHtml`。
- 现有「AI 起草」返回的纯文本以段落 HTML 插入编辑器。
- AI 润色：新 `/api/polish` 路由 + 工具栏入口；预设动作 + 自定义指令；选区优先、否则整篇。

### Out of scope（明确不做）
- 微信/QQ 等 IM 接入（已搁置：个人号无合法 API，逆向有封号/ToS 风险）。
- 附件收发、多账号、已发送邮件视图。
- 收件侧富文本渲染（已由 `<EmailBody>` iframe 白底沙盒解决，本次只动发件侧）。
- `messages` 表结构变更（已有 `bodyHtml` 列，无需迁移）。

## 架构

### 1. `<RichTextEditor>` 组件
- 库：`@tiptap/react` + `@tiptap/pm` + `@tiptap/starter-kit`（TipTap **v3**，非 v2）。
- 扩展（完整范围）：`Underline`、`Link`、`TextStyle`、`Color`、`Highlight`、`TextAlign`、`Image`、`Table`(+`TableRow`/`TableCell`/`TableHeader`)。字号 = `TextStyle` + 轻量自定义 `FontSize` 扩展（v3 核心未内置，实现时按 v3 文档确认确切包名或自写 Mark）。
- 工具栏分组：撤销/重做 ｜ 加粗/斜体/下划线 ｜ 标题/段落 ｜ 有序·无序列表/引用/代码块 ｜ 字号/颜色/高亮 ｜ 对齐 ｜ 链接/图片/表格。另含独立的「✨ 润色」入口（见 §3）。
- 受控接口：`value: string`（HTML）、`onChange: (html: string) => void`；`onUpdate` 时 `editor.getHTML()` 回调。
- 新文件：`src/components/RichTextEditor.tsx`。

### 2. ComposeMail 集成 + 发送链路 HTML
- `ComposeMail`：`body` 状态由纯文本字符串 → **HTML 字符串**；`<Textarea>` → `<RichTextEditor value={body} onChange={setBody}>`。
- `handleSend` 提交：
  - `bodyHtml = body`（编辑器 HTML）
  - `body = htmlToText(body)`（纯文本摘要，用已有 `html-to-text` 依赖；用于列表预览与不支持 HTML 的客户端）
  - POST `{ to, subject, body, bodyHtml, replyToMessageId }`
- [MailSender.send](src/lib/adapter/mail/sender.ts) 加可选 `bodyHtml?: string`；`sendMail` 加 `html: params.bodyHtml`（与现有 `text` 并存）。
- [/api/send](src/app/api/send/route.ts)：解构 `bodyHtml`；透传给 `MailSender.send`；`insert messages` 时同时写 `body`（摘要，沿用 `substring(0,500)`）与 `bodyHtml`。
- [/api/draft](src/app/api/draft/route.ts)：同样持久化 `bodyHtml`，使草稿可继续富文本编辑。
- 「AI 起草」[/api/reply](src/app/api/reply/route.ts) 仍返回纯文本；`ComposeMail` 接收后按 `\n\n` 切段、每段包 `<p>`，`setBody` 写入编辑器（保留多段结构）。

### 3. AI 润色
- 新路由 `src/app/api/polish/route.ts`，仿 `/api/reply`：
  - `POST { text, action, instruction? }`
  - `action ∈ 'grammar' | 'formal' | 'friendly' | 'concise' | 'custom'`
  - 复用 `getLlmClient()` + `getModelName()`；按 `action` 选 system prompt；`custom` 时把用户 `instruction` 拼进 prompt。
  - `temperature`：`grammar` 0.2，其余 0.5。
  - `text` 上限 20000 字符，超长截断并在响应里提示。
  - 返回 `{ polished: string }`。
- 交互（工具栏「✨ 润色」→ 菜单）：
  - 菜单项：语法修正 / 更正式 / 更亲切 / 更简洁 / 自定义…（自定义弹输入框）。
  - 取词：选区非空 → 取选区纯文本；否则 `editor.getText()`（整篇）。
  - 替换：润色结果按 `\n\n` 切段为 `<p>`；选区时 `deleteSelection()` + `insertContent`，整篇时 `setContent`。
  - loading / 错误沿用现有 `setMessage` 模式。
- **关键取舍（纯文本往返）**：润色区域**丢失行内格式**（加粗/颜色/链接等）；菜单底部明示「润色会移除选中区域的行内格式」。块级结构（段落）保留。**块级往返**（按段落/标题/列表逐块润色再包回标签）列为后续增强，不在本次。

### 4. 数据模型
- `messages` 表已有 `body` + `bodyHtml`，发件/草稿写入 `bodyHtml` 即可，**无需 schema 变更**。
- 不引入 `source` 字段（原为 IM 预留，IM 已搁置）。

## 风险与对策
- **TipTap v3 ↔ React 19.2**：已核实 `@tiptap/react@3.26.1` peer dep 含 `^19.0.0`，✅ 通过。
- **v3 扩展包名**（如 `FontSize`）：实现时按 v3 文档核对，必要时自写 Mark；不假定 v2 用法。
- **nodemailer HTML**：`text` + `html` 并存是标准用法，客户端自选渲染。
- **润色格式丢失**：v1 明示取舍，后续块级往返可改善。
- **安全**：编辑器内容由本机用户自己撰写（非外部不可信输入），发送前不清洗；图片为外链 URL，不做上传/Base64 入库。

## 测试
- `/api/polish` 单测（vitest，mock `getLlmClient`）：各 `action` 生成正确 system prompt；`custom` 拼入 `instruction`；超长截断。
- `RichTextEditor`：`onChange` 输出 HTML 结构正确；选区/整篇润色替换逻辑（mock fetch）。
- 发送链路：`/api/send` 把 `bodyHtml` 透传到 `MailSender.sendMail` 的 `html`，且 `insert` 写入 `bodyHtml`（mock 依赖）。
- 手测：写一封带格式邮件发送，收件方看到格式；选中一段点润色，该段被替换。

## 实现顺序（粗）
1. 装依赖 + `<RichTextEditor>`（工具栏）→ 接入 ComposeMail，本地可编辑。
2. 发送链路 HTML（`MailSender.send` + `/api/send` + `/api/draft` 存储）。
3. AI 起草结果段落化插入。
4. `/api/polish` 路由 + 单测。
5. 润色 UI（菜单 + 选区/整篇取词 + 替换 + loading/错误）。
6. 联调与手测。
