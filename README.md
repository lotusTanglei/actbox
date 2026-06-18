# ActBox — 本地邮件待办管理

把邮件收件箱变成可行动的任务列表。本地单机运行，数据不离电脑。

## 能力概览

**邮件**
- 多账号 IMAP 收发（163/QQ/Gmail/Outlook），SMTP 发信
- 文件夹同步 + UID 增量回写（归档/删除/移动）
- 附件收发（SHA256 落盘、流式 MIME 解析、预览、cid 内联图片）
- CC/BCC / 转发 / 草稿续编 / debounced 自动保存
- IMAP IDLE 秒级推送 + SSE `/api/events`（断线重连/状态追赶）
- 会话聚合（References/In-Reply-To + 标题规范化回退）
- 全文搜索 FTS5（中文 jieba 预分词 + Gmail 子集操作符 + bm25）

**待办**
- AI 从邮件正文抽取待办（LLM）
- 手动创建/编辑/完成/星标
- 上下文/优先级/截止日 + 过滤排序
- 邮件↔待办双向关联（来源链接 + 回跳）

**组织**
- 标签体系（多级、着色）+ 批量打标
- 规则引擎（first-match-wins：白名单/黑名单/普通，条件/动作 JSON 可编排）
- Inbox Sweep（发件人只保留最新 N 封、其余归档）
- Snooze 延后（到点唤醒 + 桌面通知）

**安全**
- DOMPurify HTML 净化（server jsdom + client 双端）+ iframe sandbox
- 垃圾评分（SpamAssassin 规则子集）+ SPF/DKIM/DMARC 认证 + 外部发件人警告
- 附件扫描器接口（可插拔，默认 noop，ClamAV 预留）

**AI（LLM 配置中心）**
- 多 provider 可配（DeepSeek / 通义千问 / 智谱 GLM）
- API Key/模型/温度/baseUrl DB 存储 + env fallback，按能力（摘要/润色/分类/抽取/回复）各自覆盖模型
- 连接测试（一键 ping）
- AI 邮件摘要（一句话/要点/正常三种风格）
- 智能回复建议（2-3 选项 JSON，容错解析）
- 智能打标（复用既有标签优先，只产建议不自动写表）

**发送增强**
- 定时发送 / 撤销窗口（默认 10s 可配，窗口内可取消）
- outbox 队列审核 + 指数退避重试 + 退信分类（5xx bounce vs 4xx 重试）
- 邮件模板（`{{name}}` 变量替换 + 自动抽取）

**效率**
- 游标分页（复合 `(received_at, id)` 游标，单文件夹 10 万封不 OOM）
- 暗色主题切换（浅色/暗色/跟随系统）
- 多选 + 批量操作（Shift+Click 范围选、归档/删除/标记已读/标星/标签/延后）

**通讯录**
- 联系人/分组 CRUD + 自动补全（合并通讯录 + 邮件历史，按权重排序）
- vCard/CSV 导入导出
- 撰写时收件人字段自动补全（↑↓ 键盘导航）

**日历**
- 本地事件表 + 月视图（日/周/月切换）
- 创建/编辑/删除日程、全天事件、地点、描述、提醒提前量
- 邮件→日程/待办一键转换

**导出**
- 待办→Obsidian Markdown（frontmatter + `- [ ]`/`- [x]` + 📅 截止/🔴 优先级/#context/📧 来源链接）
- 文件名自动按周/月/区间/全部生成
- 写 vault 文件或浏览器下载

## 技术栈

- Next.js 16 / React 19 / TypeScript
- Drizzle ORM + better-sqlite3（WAL 模式）
- node-cron（定时拉取/outbox/snooze 唤醒）
- nodemailer（IMAP + SMTP）
- OpenAI SDK（provider 无关，LLM 统一接口）
- DOMPurify + jsdom（HTML 净化）
- vitest（483 tests）

## 启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境（.env.local）
#    必填：IMAP/SMTP 服务器、邮箱、授权码
#    可选：DEEPSEEK_API_KEY / QWEN_API_KEY / ZHIPU_API_KEY

# 3. 数据库迁移
npx drizzle-kit push

# 4. 一行启动
npm run dev
```

打开 http://localhost:3400（端口见 `next.config.ts`）

## 数据安全

- 所有数据仅存本地 SQLite（`data/actbox.db`），不上传任何服务器
- API key 明文存 DB（本地硬约束；db 不入 git、不入云同步）
- 授权码/API Key 脱敏显示（`sk-***xyz`）

## 项目结构

```
src/
├── app/              # Next.js App Router 页面 + API
│   ├── api/          # RESTful API 路由
│   ├── mails/        # 邮件列表 + 详情
│   ├── compose/      # 撰写页
│   ├── contacts/     # 通讯录
│   ├── rules/        # 规则编辑器
│   ├── calendar/     # 日历
│   ├── settings/     # 设置中心
│   └── todos/        # 待办
├── components/       # 共享 UI 组件
├── lib/              # 核心逻辑
│   ├── adapter/      # MailAdapter 接口 + ImapAdapter + MailSender
│   ├── calendar/     # 日历网格 + 邮件转换
│   ├── contacts/     # 通讯录解析/仓库/补全
│   ├── db/           # Drizzle schema + 迁移 + 数据库
│   ├── export/       # Obsidian 导出纯函数
│   ├── extractor/    # AI 待办抽取
│   ├── labels/       # 标签仓库
│   ├── llm/          # LLM 客户端 + 配置 + prompt
│   ├── outbox/       # 发送队列状态机 + worker
│   ├── rules/        # 规则引擎
│   ├── search/       # FTS5 搜索 + 查询解析
│   ├── security/     # HTML 净化 + 垃圾评分 + 认证头
│   ├── sync/         # IMAP 同步引擎
│   ├── templates/    # 模板变量替换
│   └── threads/      # 会话聚合
└── __tests__/        # 483 个测试用例
```

## License

MIT
