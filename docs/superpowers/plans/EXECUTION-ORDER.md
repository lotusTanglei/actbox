# Webmail 执行索引（EXECUTION-ORDER）

> 本文件是 18 份实现计划（`plan-01` … `plan-18`）的**执行调度总表**。
> spec 来源：`docs/superpowers/specs/2026-06-17-webmail-complete-design.md` §实施路线图。
> **执行前必读本文件开头「执行方式」节。**

---

## 1. 执行方式（务必遵守）

- **内联执行，不派并行 subagent**：用 `superpowers:executing-plans` 逐任务实现。**不要**用 `superpowers:dispatching-parallel-agents` / `subagent-driven-development` 的并发模式——GLM-5.2 并行会触发 429。计划里写的 `concurrency=1` 就是为此：串行。
- **一个计划一个会话**：执行某 plan 时，上下文里只装载它 + spec。做完提交后：
  - 继续下一 plan → 当前会话 `/compact`（或直接新开一个会话）。
  - 切勿在同一长会话里堆叠多个 plan 的全文，会撑爆上下文。
- **按依赖顺序**，见下方分阶段表。**阶段 0（01 → 02）必须最先**，且此顺序不可颠倒。
- **每任务 commit + push**：用户要求每个 Task 结束都 `git add && git commit && git push`。到**计划边界**（一个 plan 全部任务完成）暂停，**等用户说「下一个」再继续**。执行由用户触发，不要自动连跑。
- **上下文以磁盘产物为准**：压缩（`/compact`）或换会话后，从这些文件重定位进度——
  - spec：`docs/superpowers/specs/2026-06-17-webmail-complete-design.md`
  - 本索引：`docs/superpowers/plans/EXECUTION-ORDER.md`（勾选 checkbox）
  - 各 plan：`docs/superpowers/plans/plan-NN-*.md`
  - git log：`git log --oneline`（每任务一 commit，可据此还原到哪了）

---

## 2. 分阶段计划表

> 列：plan 文件 | 一行目标 | 任务数 | 依赖 | 可并行点

### 阶段 0 · 地基（必须最先，此顺序不可变）

| plan | 目标 | 任务数 | 依赖 | 并行 |
|---|---|---|---|---|
| `plan-01-data-model-migration.md` | drizzle-kit 迁移框架 + 存量库基准对齐 + messages 扩列 + body 截断修复与全文回填 | 5 | 无（地基起点） | — |
| `plan-02-multi-account-adapter.md` | accounts 表 + MailAdapter 接口 + ImapAdapter（UID fetch）+ presets + 账号 CRUD/UI + 按 accountId 接线 | 7（Task 6–12） | plan-01 | 紧跟 01 |
| `plan-17-local-run-autostart.md` | 一行启动 + 不常见端口 + launchd 自启 | — | plan-01（`db:migrate`） | **可紧跟 02**，独立于 03–16 |

### 阶段 1 · 承载（依赖 01+02，三者相互独立，理论上可并行 → GLM 串行故顺序跑）

| plan | 目标 | 任务数 | 依赖 | 并行 |
|---|---|---|---|---|
| `plan-03-folders-imap-sync.md` | 真实文件夹体系（folders 表 + listFolders 同步）+ 归档/还原/删除 + UID 增量回写 | 9 | plan-01, plan-02 | 与 04/05 互独立 |
| `plan-04-attachments.md` | 附件收发全链路（sha256 落盘 + 流式 MIME 解析 + 预览/下载 + 撰写上传） | 10 | plan-01, plan-02 | 与 03/05 互独立 |
| `plan-05-compose-cc-bcc-forward.md` | 收发补全：CC/BCC/转发/草稿续编/签名 + 智能收件人校验 + debounced 自动保存 | 8 | plan-01, plan-02 | 与 03/04 互独立 |

### 阶段 2 · 实时（依赖 02+03）

| plan | 目标 | 任务数 | 依赖 | 并行 |
|---|---|---|---|---|
| `plan-06-realtime-notifications.md` | IMAP IDLE 秒级触发 + SSE `/api/events`（断线重连/追赶/幂等）+ Notification API | — | plan-01, plan-02, plan-03 | 单链 |

### 阶段 3 · P0 收尾（按各自依赖链）

| plan | 目标 | 任务数 | 依赖 | 并行 |
|---|---|---|---|---|
| `plan-07-fulltext-search.md` | FTS5 全文索引（jieba 预分词）+ Gmail 子集操作符 + Saved Search | — | plan-01, plan-03 | 与 08 独立（均需 03） |
| `plan-08-organization.md` | 标签 + 会话/线索 + 批量操作 + Snooze + 邮件转待办 | — | plan-01, plan-03 | 与 07 独立 |
| `plan-09-contacts.md` | 联系人/分组 CRUD + 自动补全 + vCard/CSV 导入导出 + 双向跳转 | — | plan-02, plan-05 | 独立（需 05） |
| `plan-10-rules-filters.md` | 规则/过滤器引擎 + 白黑名单 + Inbox Sweep + 可视化编辑器 + 试跑预览 | — | plan-02, plan-03, plan-08 | 需 08（标签） |
| `plan-11-security.md` | DOMPurify 净化（入库 + 渲染兜底）+ iframe sandbox 收紧 + 垃圾过滤 + 凭据卫生 | — | plan-01, plan-03, plan-04 | 需 04（附件钩子） |

### 阶段 4 · P1 增强（按各自依赖链）

| plan | 目标 | 任务数 | 依赖 | 并行 |
|---|---|---|---|---|
| `plan-12-ai-llm-config.md` | LLM 配置中心 + AI 摘要/翻译/智能打标（建议）+ provider preset | — | plan-02, plan-08 | 需 08（标签落库） |
| `plan-13-schedule-undo-templates.md` | 定时发送 + 撤销发送 + 模板 + outbox 状态机/重试/退信 | — | plan-02, plan-05 | — |
| `plan-14-ux-performance.md` | 虚拟列表分页/游标 + 快捷键 + 冲突检测 + worker_threads + i18n | — | plan-03, plan-08 | 需 08（批量端点） |
| `plan-15-settings-unified.md` | 设置中心统一（账号/LLM/规则/快捷键/主题）+ 数据导入导出 | — | plan-02, plan-09, plan-10, plan-14 | 依赖最重，靠后 |
| `plan-16-calendar.md` | 日历/日程 + 邮件转日程 + 提醒（经 plan-06 eventBus/SSE）+ .ics 预留 | — | plan-02, plan-06 | 需 06（通知通道） |
| `plan-18-export-todos-obsidian.md` | 导出待办 → Obsidian（写 vault / 下载）+ frontmatter + 范围选择 | — | 无 | **任意时点可做** |

> spec 备注：OAuth2/POP3/Exchange 等附加协议适配器随多账号需要提前插入（OAuth2 优先），不在 18 份内。

---

## 3. 执行清单（执行时勾选）

阶段 0 · 地基

- [x] plan-01 数据模型 + 迁移（drizzle-kit / messages 扩列 / body 回填）✅
- [x] plan-02 多账号 + MailAdapter（accounts / ImapAdapter / 账号 UI）✅
- [x] plan-17 一行启动 + 自启（端口 / launchd）✅

阶段 1 · 承载

- [x] plan-03 文件夹体系 + IMAP 双向同步 ✅
- [x] plan-04 附件系统 ✅
- [ ] plan-05 收发补全（CC/BCC/转发/草稿/签名）

阶段 2 · 实时

- [ ] plan-06 实时性与通知（IDLE + SSE + Notification）

阶段 3 · P0 收尾

- [ ] plan-07 全文搜索（FTS5）
- [ ] plan-08 组织整理（标签/会话/批量/Snooze/转待办）
- [ ] plan-09 联系人通讯录
- [ ] plan-10 规则与过滤器
- [ ] plan-11 安全（收敛版）

阶段 4 · P1 增强

- [ ] plan-12 AI 增强 + LLM 配置中心
- [ ] plan-13 定时/撤销发送 + 模板
- [ ] plan-14 效率与体验（虚拟列表/快捷键/worker）
- [ ] plan-15 设置中心统一化
- [ ] plan-16 日历与日程
- [ ] plan-18 导出待办 → Obsidian

---

## 4. 关键约束（依赖硬规则）

**阶段 0**
- `plan-01`（数据模型 + 迁移）→ `plan-02`（多账号 + 适配器）**必须最先且此顺序**：02 的 accounts/`accountId` 列、MailAdapter 接口都建在 01 的迁移框架与 messages 扩列之上。
- `plan-17`（本地启动 + 自启）**可紧跟 02**：它只依赖 01 的 `db:migrate` 脚本，尽早落地方便后续迭代验证。

**阶段 1**
- `plan-03 / 04 / 05` 均依赖 `plan-01 + plan-02`，三者相互独立、逻辑上可并行；但 **GLM 串行执行，故顺序跑**（建议 03 → 04 → 05，因 06/07/08/10/11 都等 03）。

**阶段 2**
- `plan-06`（实时）依赖 `plan-02 + plan-03`（IDLE 需多账号 adapter，事件需 folders/`applyAction`）。

**阶段 3**
- `plan-07`（搜索）依赖 `plan-01 + plan-03`（FTS5 跨 folder/account 检索 + body 全文）。
- `plan-08`（组织）依赖 `plan-01 + plan-03`（批量经 `applyAction` UID 回写 + folders 语义）。
- `plan-09`（联系人）依赖 `plan-02 + plan-05`（accountId 隔离 + `to/cc/bcc` 拆分）。
- `plan-10`（规则）依赖 `plan-02 + plan-03 + plan-08`（applyAction 动作 + `labels`/`message_labels`）。
- `plan-11`（安全）依赖 `plan-01 + plan-03 + plan-04`（folders type=spam + 附件落盘钩子）。
- 阶段 3 内部建议顺序：07 → 08 → 09 →（10 须在 08 后）→（11 须在 03/04 后）。

**阶段 4**
- `plan-12`（AI + LLM）依赖 `plan-02 + plan-08`（智能打标建议落库交 plan-08 标签写入）。
- `plan-13`（定时发送）依赖 `plan-02 + plan-05`（按 accountId sender + compose 流程）。
- `plan-14`（UX）依赖 `plan-03 + plan-08`（列表视图 + 批量端点）。
- `plan-15`（设置）依赖 `plan-02 / 09 / 10 / 14`（聚合各模块配置 + 主题/快捷键）——**依赖最重，阶段 4 最后**。
- `plan-16`（日历）依赖 `plan-02 + plan-06`（eventBus/SSE 推提醒）。
- `plan-18`（Obsidian 导出）**无依赖，任意时点可做**（只读 todos/messages/settings）。

---

## 5. 里程碑验收（每阶段整体收口）

> 引用各 plan 末「验收标准」节 + spec §实施路线图。每阶段全部 plan 完成后整体过一遍。

- **阶段 0 验收**（地基）：见 `plan-01` §阶段 0 整体验收与自检、`plan-02` 验收、`plan-17` 验收。要点——真实旧库 `db:migrate` 不丢数据、messages 全列就位、body 全文回填成功、多账号可连可收发、`npm run dev` 一行起 + launchd 自启生效。
- **阶段 1 验收**（承载）：三 plan 各自验收 + spec §阶段 1。要点——真实文件夹双向同步（移动/标记 UID 回写幂等）、附件收发预览/下载全链路、CC/BCC/转发/草稿续编可用。
- **阶段 2 验收**（实时）：`plan-06` 验收 + spec NFR（SSE 可靠性/IDLE 并发）。要点——收到新邮件秒级 SSE 推送、断线重连 + 状态追赶 + 多标签页复用、桌面通知分级授权。
- **阶段 3 验收**（P0 收尾）：5 plan 各自验收 + spec §阶段 3。要点——FTS5 检索 <500ms 含中文、标签/会话/批量/Snooze、联系人自动补全、规则引擎试跑预览、HTML 净化防 XSS。
- **阶段 4 验收**（P1 增强）：6 plan 各自验收 + spec §阶段 4。要点——AI 摘要/打标建议、定时/撤销发送 outbox 状态机、虚拟列表分页/快捷键、设置中心统一 + 数据导入导出、日历提醒、Obsidian 导出。
