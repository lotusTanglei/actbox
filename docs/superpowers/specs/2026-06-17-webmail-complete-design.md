# actbox 完整 Web 邮箱 — 需求与设计规格

- 日期：2026-06-17
- 目标：把 actbox 补全成【网易邮箱大师级】web 邮箱客户端，整合已有的邮件抽取待办 + AI 能力。
- 部署形态：**纯本地单机单用户**（不考虑公网/云/多用户/Serverless/横向扩展）。
- 落地方式：本需求文档 → 分解子项目 → 分阶段用 superpowers（executing-plans / Workflow + 检查点）实现。

## 范围

**In scope**：多账号收发、文件夹同步、附件、全文搜索、联系人、规则、组织整理、实时推送、安全（收敛版）、AI 增强 + LLM 配置、定时/撤销发送、模板、效率/UX、设置中心、日历（companion）、**一行启动 + 自启**、**导出待办→Obsidian**。

**Out of scope（本地 lens 明确砍掉）**：
- 凭据加密 / credentials 表 / 主密钥（auth_code 明文存，与 `.env.local` 一致）。
- 多用户认证 / 2FA / 远程会话 / 多设备登录态。
- 对象存储 / 外部搜索索引（Meilisearch）/ 独立同步微服务。
- 公网部署、横向扩展。

---

## 0. 架构设计（方案 B）

单一 Next.js 进程 + 单个 SQLite（WAL）不变，内部三层解耦：

1. **AccountProvider 适配器抽象**：统一 `MailAdapter` 接口（`testConnection / listFolders / fetch / send / move / delete / markRead`），IMAP 为首个实现（`ImapAdapter` 由现有 `MailReceiver/Sender` 重构而来），OAuth/POP3 后续作为可插拔实现。凭据经 `accounts` 表按 accountId 取（**明文 auth_code**），移除 `IMAP_USER/IMAP_AUTH_CODE` 单例硬编码。
2. **进程内持久化队列**：SQLite `jobs` 表承载同步任务，把现在 `scheduler`/`/api/fetch` 里"拉取→解析→规则匹配→入库→LLM 抽取"的内联逻辑拆成独立 stage，每个 stage 可重试、可观测、账号粒度并发上限。慢 LLM / 大附件不再阻塞整个同步循环。
3. **同步引擎**：INBOX 走 **IMAP IDLE**（秒级推送，29min 打断重 SELECT 续命避开 30min 超时，断线指数退避重连）；其余文件夹 node-cron 轮询（15–30min）；垃圾/草稿打开即拉。增量用 `folder + UIDVALIDITY + UID`（CONDSTORE 优先，不支持则降级定期全量 FLAGS 扫描）。已读/删除即时 UID STORE + 乐观更新。

**存储选型**：附件本地内容寻址（`attachments/{accountId}/{messageId}/{sha256}.bin` 落盘，sha256 去重，删除邮件级联删文件）；全文搜索 **SQLite FTS5**（与主库同事务强一致、零双写；中文用 jieba 分词）。

**为何不选 A / C**：
- **A（单体原地扩展）**：改动最小、最快，但 cron 回调里 IMAP+DB+LLM 强耦合不会被打破——单封大邮件/慢抽取会卡住整个同步循环、无重试隔离、`receiver.ts` 迅速膨胀。actbox 已到"多账号就触底"的临界点，A 的债会线性恶化。
- **C（独立同步服务 + 对象存储 + 搜索侧车）**：架构最干净但本地单机**严重过度工程**，1 进程变 2+ 进程 + Redis/MinIO/Meilisearch，运维与跨进程一致性成本远超收益。
- **B 在改动收益比、与现状契合度、未来可迁移性上全面胜出**：单库单进程的极简部署不变，又拿到解耦/可扩展/可观测。若将来真上多用户/大规模，B 的 adapter+队列分层是平滑迁移到 C 的垫脚石。

**安全收敛（本地 lens）**：不加密凭据、不做多用户；只保留 **收件 HTML 的 DOMPurify 净化（防 XSS）** + 垃圾过滤。卫生点：`data/actbox.db` 与 `.env.local` 不入 git、不入不加密云同步。

---

## 1. 全局数据模型

最终表（演进自现有 `todos/messages/settings`）：

- **accounts**(id, email[UNIQUE], provider, protocol, imap_host, imap_port, smtp_host, smtp_port, user, **auth_code[明文]**, oauth_refresh_token, display_name, is_active, sync_mode, last_synced_at, sync_status, sync_error, created_at)
- **messages**(现有列 + account_id, folder, imap_uid, imap_seq, to, cc, bcc[拆分单 recipient], thread_id, is_archived, archived_at, snoozed_until；**body 改存全文纯文本不再截断**)
- **folders**(id, account_id, path, display_name, type[inbox/sent/drafts/trash/spam/archive/custom], unread_count, total_count)
- **attachments**(id, account_id, message_id, filename, mime_type, size, content_id, is_inline, storage_path, sha256, downloaded_at)
- **labels**(id, account_id, name, color) + **message_labels**(message_id, label_id)
- **jobs**(id, account_id, type, folder, payload[JSON], status[queued/running/done/failed/dead], attempts, run_at, error) — 进程内队列
- **rules**(id, account_id, name, enabled, conditions[JSON], actions[JSON], order)
- **templates**(id, account_id, name, body_html, variables[JSON])
- **contacts**(id, account_id, name, email, phone, note, avatar_path, group_id, contact_count, last_contacted_at) + **contacts_groups**(id, account_id, name)
- **outbox**(id, account_id, to, cc, bcc, subject, body_html, scheduled_at, status[queued/sending/sent/failed/bounced], attempts, error)
- **todos**(现有列 + account_id)
- **settings**(现有 key-value)

**关键索引**：`idx_messages_account_folder_uid(account_id, folder, imap_uid)`（增量同步主路径）、`idx_messages_thread(thread_id)`、`idx_messages_account_received(account_id, received_at)`（聚合收件箱）。

> **无 `credentials` 表**：凭据不加密，auth_code 明文存 accounts（本地硬约束）。

---

## 2. Schema 迁移策略 + 关键前置

### 2.1 迁移机制（必须最先建）
- 现状 `getDb()` 的 `autoCreateTables` 仅以 `todos` 表是否存在为判据，首次建表后**永不再执行**——加表加列对存量库静默失败、运行时崩。
- 引入 **drizzle-kit**：`drizzle.config.ts`（dialect sqlite，out `./drizzle`，db `data/actbox.db`）；脚本 `db:generate` / `db:migrate` / `db:backfill`。`getDb()` 启动改为 `migrate(db)` 跑 `drizzle/*.sql`。
- **基准对齐 `scripts/align-baseline.ts`**：针对"无迁移历史但表已存在"的存量库，检测期望列 vs 实际列，对缺失列 `ALTER TABLE ADD COLUMN`（带 DEFAULT）、缺失表 `CREATE TABLE IF NOT EXISTS`。这是 drizzle-kit 对既有库的标准对齐手段。
- 启动顺序：`migrate()` → 若无 `__drizzle_migrations` 记录但表已存在则跑 `align-baseline` → 进入服务。

### 2.2 修复 body 截断（数据破坏）
- 三处 `body.substring(0, 500)`：`src/app/api/fetch/route.ts`、`src/app/api/send/route.ts`、`src/lib/scheduler/index.ts`。已落库历史全文不可恢复。
- 改为存 `msg.body` 全量（`body_html` 本就全量）。`body` 语义从"截断摘要"变为"清洗后全文纯文本"；列表预览用 `substr(body,1,200)`。
- **回填脚本 `scripts/backfill.ts`**（幂等、可重复）：遍历 `length(body)<=500` 的疑似截断行，按 `messageId` 在 IMAP 重拉源、重新解析清洗、回写全文 + `imap_uid`；失败行记 `sync_status='backfill_failed'`，不中断（部分历史邮件因保留期/messageId 缺失无法回填是预期内）。

### 2.3 MSN → UID
- `receiver.ts` 现用 `search({seen:false})` 走 sequence number（commit a1967ac 自称修 bug，实为多账号增量同步的正确性隐患——expunge 后 sequence 重排）。改回 `folder + UIDVALIDITY + UID` 作持久标识。

### 2.4 收件 HTML 净化
- 收件 `bodyHtml` 渲染前必须经 **DOMPurify** 净化（防 `<script>` / `<img onerror>` 等 XSS）。`EmailBody.tsx` 的 iframe 渲染入口接入。

### 2.5 备份一致性
- SQLite 热备份用 `VACUUM INTO` / `.backup`（非拷贝 db 文件，避免 WAL 不一致）；备份必须**原子覆盖 db + 附件目录**两者，否则恢复后元数据指向不存在文件或孤立文件占盘。

---

## 子项目路线图

### 子项目 1 — 数据模型演进 + Schema 迁移机制（地基）
- **目标**：落地最终版 `messages` 扩展列 + 全部新表的迁移框架；修 body 截断；铺好后续加表加列的地基。
- **现状**：`autoCreateTables` 脆弱、无 `drizzle/` 目录、`messages` 缺列、三处 body 截断。
- **详细需求**：见 §2.1（迁移框架 + align-baseline）、§2.2（修截断 + 回填）；`messages` 加 `account_id/folder/imap_uid/imap_seq/to/cc/bcc/thread_id/is_archived/archived_at/snoozed_until`（带 DEFAULT 的 ALTER，nullable 过渡）。
- **数据模型**：见 §1（messages 扩展 + 新索引）。
- **接口变更**：无新路由；改 `getDb()`、三处去截断；新增 `scripts/align-baseline.ts`、`scripts/backfill.ts`；`RawMessage` 增 `accountId/folder/imapUid/imapSeq/to/cc/bcc`。
- **验收**：空库冷启动可建全列表；旧库启动后新列存在默认值正确、旧行不丢；`db:backfill` 后截断邮件 body 全文恢复、`imap_uid` 非空；`grep substring(0, 500)` 为空；新增 `migration.test.ts` 通过。
- **依赖**：无（地基首项；与子项目 2 的 accounts 表同一批 `db:generate`）。
- **风险**：存量库基准对齐是最大坑，必须在真实旧库上验证；回填受服务商保留期限制。

### 子项目 2 — 多账号抽象 + MailAdapter + 账号管理 UI（地基 · = 用户"添加邮箱"）
- **目标**：单账号硬编码重构为多账号可插拔、统一收件箱聚合；建 `accounts` 表（明文 auth_code）、`MailAdapter` 接口、`ImapAdapter`、服务商 presets、账号 CRUD/连接测试/启停/切换 UI。
- **现状**：`receiver.ts/sender.ts` 硬编码 163 + env 单例；`types.ts` 的 `SourceAdapter` 只有 `fetchNew`（太窄）；无 accounts 表；Sidebar 写死 "163" 徽标；settings 无账号管理。
- **详细需求**：
  1. `accounts` 表（明文 auth_code，见 §1）；无 credentials 表。
  2. `MailAdapter` 接口（testConnection/listFolders/fetch/send/move/delete/markRead）；`MailReceiver/Sender` 退化为 `ImapAdapter` 实现。
  3. **服务商 presets**：163/126/qq/gmail/outlook 的 imap/smtp host/port/secure 默认值，"一键添加"只需账号 + 授权码。
  4. **账号管理 UI**（settings 新页/分区）：列表增删改、启用停用、每账号连接状态 + 最后同步时间、重连/重新授权、证书与端口连接诊断（`testConnection`）。
  5. Sidebar 动态渲染账号列表，支持账号切换 + 统一收件箱聚合视图；Sender/Receiver/Scheduler 全部按 accountId 取配置。
  6. 凭据卫生：README/AGENTS 注明 db 与 .env.local 不入 git、不入不加密云同步。
- **数据模型**：`accounts` 表 + `messages.account_id` 外键。
- **接口**：`/api/accounts`（GET/POST/PATCH/DELETE）、`/api/accounts/[id]/test`（连接测试）。
- **验收**：能添加 163+qq 两个账号并各自连接成功；统一收件箱聚合两账号邮件、按账号可切换；删除 env 单例后仍能按库内账号收发；连接诊断能区分"密码错/端口不通/证书"。
- **依赖**：子项目 1（accounts 表 + messages.account_id）。
- **风险**：OAuth2（Gmail/Microsoft）放附加协议适配器（子项目后置）；多账号并发写入库的 SQLITE_BUSY 重试。

### 子项目 3 — 标准文件夹体系 + IMAP 双向同步（承载）
- **目标**：从"只连 INBOX 的客户端虚拟过滤"升级为"真实邮箱文件夹"：同步服务器文件夹到本地 `folders` 表；收件箱/已发送/草稿/垃圾/已删除/归档完整视图 + 未读角标；归档、垃圾箱还原；本地操作通过 UID 增量回写服务器。
- **现状**：文件夹全是客户端虚拟过滤（direction + is_read/is_starred）；只连 INBOX；无归档/垃圾箱视图；messages 无 folder/accountId/imapUid 列。
- **详细需求**：`MailAdapter.listFolders()` 双向同步；系统文件夹视图 + 角标；归档（`is_archived`，移出收件箱可恢复）；垃圾箱（`is_deleted` 列表 + 还原 + 彻底删除 + 保留期到期清除）；本地移动/标记/标星经 UID 增量回写（冲突按 UID+modseq，断点续传 + 幂等）；自定义文件夹创建 + IMAP 同步。
- **数据模型**：`folders` 表；messages 的 `folder/imap_uid/imap_seq/is_archived/archived_at`（子项目 1 已加列）。
- **接口**：`/api/folders`、`/api/messages/[id]` 增 `move/archive/restore` 动作。
- **验收**：6 类系统文件夹可见且角标正确；归档/还原生效且同步到服务器；网络抖动下移动/标星不丢不重。
- **依赖**：子项目 1、2。
- **风险**：必须用 UID（非 MSN）做持久标识；UIDVALIDITY 变化时重新映射而非重复入库。

### 子项目 4 — 附件系统（承载）
- **目标**：补全附件收发全链路：接收下载落盘、发送带附件、撰写文件选择器/拖拽/粘贴截图、列表 + 预览 + 下载、安全防护。
- **现状**：全链路缺失——receiver 不下载附件、sender 无 attachment 参数、ComposeMail 无文件选择器、RichTextEditor Image 仅 URL。
- **详细需求**：`attachments` 表；receiver 解析 MIME multipart 逐附件按 sha256 落盘、保留 Content-ID 供内联渲染；`MailSender.send()` 加 `attachments` 参数（nodemailer 原生支持，含内联 CID）；ComposeMail 文件选择器 + 拖拽上传 + 批量 + 粘贴截图转内联附件；附件列表 UI + 强制 `Content-Disposition: attachment` 下载 + 按 mimeType 图标；图片/PDF 预览（iframe/viewer）；单附件/单邮件大小上限（MIME 解析 OOM 防护，流式解析）、路径穿越防护（filename 含 `../`）、ZIP 炸弹检测；预留病毒扫描钩子接口。
- **数据模型**：`attachments` 表。
- **接口**：`/api/messages/[id]/attachments/[aid]`（GET 下载）、compose 发送支持 multipart。
- **验收**：能收/发/预览/下载附件；内联图片正常渲染；落盘按 sha256 去重；恶意文件名不穿越路径。
- **依赖**：子项目 1、2。
- **风险**：大附件内存——必须流式解析；sha256 文件被多邮件引用时的引用计数 + 安全删除。

### 子项目 5 — 收发补全：CC/BCC/转发/草稿续编/签名（承载）
- **目标**：补齐 compose/send 侧：CC/BCC、转发、草稿 PATCH 续编、debounced 自动保存、签名按账号自动追加、收件人智能校验。
- **现状**：sender 只有 `to`、DB 单 recipient 列、无转发、无草稿 PATCH、签名存了但 sender 不 append。
- **详细需求**：messages recipient 拆为 to/cc/bcc；sender 透传 cc/bcc；ComposeMail 可折叠 CC/BCC 框；`/api/draft/[id]` PATCH 续编；编辑器 debounced（≤10s）自动保存；按 accountId 加载并自动追加签名（编辑层负责，非 sender）；转发（引用原文 + Auto-Submitted/References 头）；收件人校验（外部域提醒、"提到附件但未添加"检测）。
- **数据模型**：messages `to/cc/bcc`（子项目 1 已加）。
- **接口**：`/api/send` 增 cc/bcc/forward；`/api/draft/[id]` PATCH。
- **验收**：CC/BCC 收件方正确；草稿续编不丢内容；自动保存生效；新邮件自动带签名；转发引用原文。
- **依赖**：子项目 1、2。
- **风险**：body 截断修复（子项目 1）后搜索才有完整正文。

### 子项目 6 — 实时性与通知
- **目标**：新邮件 <30s、状态变更 <10s。每活跃账号维持 IMAP IDLE；SSE 推送替代 60s 轮询；桌面/浏览器通知。
- **现状**：只有轮询（客户端 60s 计数 + cron 30min fetch），无 IDLE/SSE/通知。
- **详细需求**：IDLE 长连接（每账号一条，收到 EXISTS 即拉，29min 续命，断线退避重连，不健康自动降级轮询）；SSE 通道推送新邮件/未读数/状态变更（断线重连 + 状态追赶 + 事件幂等）；Notification API 桌面通知（按账号/文件夹分级、声音、角标，需授权）；已读/移动/标星 UID 增量同步 <10s。
- **接口**：`/api/events`（SSE）；`refresh-bus` 扩展为服务端发布订阅。
- **验收**：新邮件到达秒级出现在列表；标记已读 <10s 反映；断网恢复后状态追赶不丢。
- **依赖**：子项目 2、3。
- **风险**：IDLE 在 Next.js 进程内（本地自托管 OK，不能 Serverless）；SSE 多标签页连接复用。

### 子项目 7 — 全文搜索（FTS5）
- **目标**：跨文件夹/账号统一检索、<500ms、相关性排序、搜索操作符。
- **现状**：SQL LIKE on subject/from/body（且 body 截断 500），无 bodyHtml 搜索、无排序、无操作符。
- **详细需求**：`messages_fts` FTS5 虚表（外部内容表 + 触发器同步，索引 subject/from/to/全文 body），MATCH + bm25 排序；中文 jieba 分词；搜索改查 FTS5；操作符解析器（from:/to:/subject:/has:attachment/after:/before:/is:unread/is:starred，Gmail 子集）；搜索结果页（排序 + 二次过滤）；保存的搜索（常驻侧栏）；搜索历史 + 联想。
- **数据模型**：`messages_fts` 虚表 + 触发器（迁移随子项目 1 框架）。
- **接口**：`/api/messages` GET 改 FTS5 查询；`/api/search/saved`。
- **验收**：搜索 <500ms；跨文件夹/账号；操作符生效；body 截断修复后历史正文可搜。
- **依赖**：子项目 1（全量 body）、3（跨文件夹）。
- **风险**：FTS5 中文分词构建依赖（jieba 跨平台）；触发器同步写入对入库延迟的放大。

### 子项目 8 — 组织整理：标签/会话/批量/Snooze/转待办
- **目标**：标签系统、会话线索视图、批量操作、Snooze、邮件一键转待办。
- **现状**：有星标/虚拟文件夹/todo-mail 关联；缺标签、会话视图、批量、Snooze。
- **详细需求**：`labels` + `message_labels`（多标签/嵌套/着色）；会话视图（依 In-Reply-To/References/规范化 Subject 聚合，`thread_id`）；列表多选 + 范围选后批量归档/删除/标记/标星/贴标签/移动；Snooze（`snoozed_until` + 定时任务回顶）；邮件一键转 todo（复用现有 todo-email linking 补 UI）。
- **数据模型**：`labels/message_labels`；messages `thread_id/snoozed_until`（子项目 1）。
- **验收**：多标签着色过滤；会话折叠展开；批量操作生效；Snooze 到点回顶；邮件转待办后双向关联。
- **依赖**：子项目 1、3。

### 子项目 9 — 联系人通讯录
- **目标**：通讯录 CRUD、收件人自动补全、分组群发、导入导出、与邮件双向跳转。
- **现状**：无 contacts 表/UI/自动补全。
- **详细需求**：`contacts` + `contacts_groups`；CRUD UI（独立页 + settings 入口）；ComposeMail 收件人自动补全（通讯录 + 历史通信记录，高频置顶）；邮件详情"加入通讯录"；CSV/vCard 导入导出；联系人↔邮件双向跳转；最近/常用自动记录。
- **数据模型**：`contacts/contacts_groups`。
- **验收**：收件人输入即联想；群发到组；导入 vCard 后可用；点联系人查往来邮件。
- **依赖**：子项目 2、5。

### 子项目 10 — 规则与过滤器
- **目标**：按发件人/主题/关键词/附件自动移动/删除/转发/标星/贴标签。
- **现状**：无规则系统。
- **详细需求**：`rules` 表（conditions/actions JSON + order）；规则引擎挂同步流水线对新邮件顺序匹配（本地动作即时、IMAP 动作经适配器回写）；可视化条件构建器 + 动作 + 优先级 + 启用停用 + 试跑（对历史邮件）；白/黑名单；Inbox Sweep（一键归档某发件人旧邮件）。
- **数据模型**：`rules`。
- **验收**：规则匹配后自动执行动作并同步服务器；试跑预览正确；规则可启停排序。
- **依赖**：子项目 2、3、8。

### 子项目 11 — 安全（收敛版）
- **目标**：本地单用户下必要的安全：收件 HTML 净化防 XSS、垃圾过滤、钓鱼/外部发件人标识、附件接收侧扫描钩子。**不做**多用户 auth/2FA/远程会话。
- **详细需求**：DOMPurify 净化 bodyHtml（子项目 1/前置已要求，此处落地 + 测试）；垃圾过滤（SpamAssassin 规则或轻量分类器，自动隔离垃圾箱 + 标记/取消/举报反馈训练）；钓鱼/恶意链接警告 + SPF/DKIM/DMARC 失败标识；外部发件人显式标识；附件接收侧病毒扫描钩子（与子项目 4 协同，预留接口）。
- **验收**：含 `<script>` 的邮件不执行；垃圾自动进垃圾箱可恢复；外部邮件有标识。
- **依赖**：子项目 1（DOMPurify）、2、3、4。
- **风险**：垃圾误判——需白名单学习 + 可逆。

### 子项目 12 — AI 增强 + LLM 配置中心（= 用户"LLM 配置"）
- **目标**：在现有 provider 抽象上扩展能力集 + 做成完整可配的 LLM 配置中心。
- **现状**：已有 AI 草稿/润色/待办提取/多 provider；settings 有 LLM tab（env 只读）。
- **详细需求**：AI 邮件摘要（列表/详情一键）、智能回复建议（2-3 简短选项）、智能分类打标（标签/优先级/重要度建议）；**能力可插拔**——摘要/润色/分类各自可配不同底层模型；**LLM 配置中心**：多 provider（OpenAI 兼容/智谱 GLM 等）、模型/key/温度、连接测试、按能力切换；设置页可改（不再 env 只读）。
- **数据模型**：`settings` 增 LLM 配置项（provider/model/key/temperature 按能力分组）；可选 `llm_configs` 表。
- **接口**：`/api/llm/config`（GET/PATCH）、`/api/llm/test`；`/api/summarize`、`/api/suggest-reply`、`/api/auto-tag`。
- **验收**：能在设置页切换 provider/模型/key 并测试连通；摘要/智能回复/打标生效；各能力可分别配模型。
- **依赖**：子项目 2、8（打标依赖标签）。
- **风险**：key 明文存（本地接受，卫生同 auth_code）。

### 子项目 13 — 定时/撤销发送 + 模板
- **目标**：定时发送、撤销发送、邮件模板。
- **现状**：点击即发，无定时/撤销/模板。
- **详细需求**：`outbox` 表 + `scheduled_at`，定时任务到点经 MailSender 发出（支持时区，存 UTC）；撤销发送（5/10/20/30s 可配延迟窗口内取消，仅延迟发信）；`templates` 表（富文本 + 变量占位，撰写快速插入）；P2：邮件合并、已读回执预留接口。
- **数据模型**：`outbox`、`templates`。
- **验收**：定时邮件到点发出；撤销窗口内取消成功；模板插入带变量。
- **依赖**：子项目 2、5。
- **风险**：发送失败/退信——outbox 状态机（queued/sending/sent/failed/bounced）+ 指数退避重试 + 退信解析。

### 子项目 14 — 效率与体验
- **目标**：虚拟滚动、快捷键、响应式移动端、PWA 离线、暗色主题切换、无障碍。
- **现状**：三栏固定布局无断点；无快捷键/虚拟滚动/PWA；暗色无 toggle。
- **详细需求**：虚拟滚动（react-window，单文件夹 10 万+ 不卡，首屏 <1.5s，**配合 API 分页/游标替代 `.all()` 全量**）；快捷键体系（j/k/r/c/e/#/s// 等，可自定义 + 冲突检测 + 帮助浮层 + 焦点管理）；响应式/移动端断点（三栏→小屏单栏 + 抽屉导航 + 触摸手势）；PWA + Service Worker（可安装 + 离线缓存最近邮件 + 断网待同步）；暗色主题切换 provider；无障碍（字体缩放/键盘可达/aria）。
- **验收**：10 万封列表滚动流畅；快捷键可用且可自定义；小屏布局降级正常；可安装为桌面应用。
- **依赖**：子项目 3、8。
- **风险**：`GET /api/messages` 当前 `.all()` 全量返回——必须改分页/游标，否则 10 万封 OOM；better-sqlite3 同步 API 阻塞事件循环，长查询考虑 worker_threads 隔离。

### 子项目 15 — 设置中心统一化
- **目标**：聚合各功能配置入口 + 数据导入导出 + i18n + 可观测性。
- **现状**：settings 4 tab（Email/LLM/Scheduler/Signature）。
- **详细需求**：统一入口 + 分区（账号/显示主题/快捷键/规则/签名多套按账号）；数据导入导出（邮件/待办/联系人 CSV/JSON，跨客户端迁移）；i18n 框架（抽离硬编码中文 + 时区/日期本地化 + RFC2047 附件名解码）；可观测性（连接健康度/同步状态/错误日志可见可导出）；UTF-8 全编码邮件正确解析校验。
- **验收**：设置页覆盖所有功能配置；能导出/导入数据；切换语言生效；同步错误可见。
- **依赖**：子项目 2、9、10、14。

### 子项目 16 — 日历与日程（companion）
- **目标**：内置日历、邮件转日程/转任务、提醒；CalDAV 为 P2。
- **现状**：无日历；有 todo 系统。
- **详细需求**：日/周/月视图 + 创建日程 + 到点提醒；邮件一键转日程/转任务（转任务复用 todo-email linking 补 UI）；P2：会议邀请 iCalendar/RSVP、通知中心、CalDAV/Exchange 同步。
- **依赖**：子项目 2、9、6。
- **备注**：companion 能力，优先级最低，可最后做或按需启动。

### 子项目 17 — 本地运行与部署（用户新增）
- **目标**：一行命令启动 + 不常见默认端口 + macOS 开机自启。
- **详细需求**：
  - `./start`（或 `npm start`）：一条命令拉起，内部自动 `db:migrate`（含 align-baseline）+ 加载 env + 起 Next 服务。
  - 默认端口 **8321**（避开 3000/8080 等高冲突口），可通过 `PORT` 环境变量覆盖。
  - **macOS launchd 自启**：`scripts/install-autostart.sh` 生成并加载 `~/Library/LaunchAgents/com.actbox.plist`（含工作目录、`PORT=8321`、`KeepAlive` 崩溃重启、标准输出/错误重定向到日志）；`scripts/uninstall-autostart.sh` 卸载。
  - 日志输出到 `data/logs/`，便于排障。
- **验收**：`./start` 一条命令起服务、库自动迁移；8321 可访问；安装自启后重启机器服务自动起、崩溃自动重启；卸载脚本清理干净。
- **依赖**：子项目 1（启动跑迁移）。
- **备注**：建议紧跟地基做，方便后续迭代边自启边验证。

### 子项目 18 — 导出待办 → Obsidian（用户新增）
- **目标**：把待办按范围导出成 Obsidian 友好 Markdown，放进 vault 做归纳总结。
- **详细需求**：
  - 格式：Markdown——可选 frontmatter（范围/数量/导出时间）+ `- [ ]`/`- [x]` 复选框列表，每条带元数据（📅 截止 / 🔴 优先级 / context / 📧 来源邮件主题 + 链接）。
  - 范围筛选：按日期段（创建/完成/截止）、状态（待办/已完成）、优先级、context/tag、来源邮件。
  - 去向：可配置 vault 路径（如 `/Users/.../ob/Tanglei/`）或下载；文件名按范围命名（如 `todos-2026-W24.md`）。
  - UI：待办页"导出"入口 + 范围选择器 + 预览。
- **数据模型**：无新表（读 todos + 关联 messages）。
- **接口**：`/api/todos/export`（POST 范围 → 返回 markdown 或写文件）。
- **验收**：选定范围导出后，markdown 在 Obsidian 中可读、复选框可勾、元数据完整；范围筛选准确。
- **依赖**：无（可独立做，建议挂设置/组织或独立小项）。
- **待确认**（实现时）：导出格式细节 / 默认范围 / 是否复用用户既有 inbox daily-note 结构。

---

## 非功能需求（横切）

- **性能**：`GET /api/messages` 改分页/游标（替代 `.all()` 全量）；better-sqlite3 同步 API 阻塞事件循环——重查询/大事务用 worker_threads 隔离或限流；FTS5 触发器写入对入库延迟的影响需测量；列表虚拟滚动。
- **并发**：多账号 IDLE 同时写入库的 SQLITE_BUSY 重试（WAL 缓解非消除）。
- **可靠性**：同步全链路幂等（修 `no-id-${Date.now()}` 兜底导致的永久不去重 + 重复扣 LLM）；邮件入库与 todo 入库事务包裹（无孤儿）；死信队列（jobs status=dead）；outbox 发送失败状态机 + 退信解析 + 指数退避。
- **可观测性**：指标采集（同步延迟/IDLE 在线率/队列积压/LLM 成本/IMAP 错误率），设置页可见可导出；结构化日志（替代裸 console.log）。
- **备份恢复**：SQLite `VACUUM INTO` 热备份 + 附件目录原子覆盖；灾难恢复 RTO/RPO + 备份完整性校验。
- **国际化/无障碍**：i18n 抽离硬编码中文；jieba 分词；RFC2047 主题/附件名解码；aria-live 新邮件通知；富文本编辑器屏幕阅读器支持。
- **空/加载/错误态**：收件箱空状态文案、骨架屏 + 乐观更新、单封加载态、IMAP 失败错误态 + 重试、队列卡死告警、附件下载失败态、AI 超时态；统一错误边界。
- **邮件去重**：跨账号去重、UIDVALIDITY 变化重新映射、messageId 缺失分支的去重主键。
- **时区**：scheduledAt/snoozedUntil 存 UTC、收件 receivedAt 解析 Date header 时区、列表本地化、cron 时区、日历 DST。
- **SSE 可靠性**：断线重连 + 指数退避 + 状态追赶 + 事件幂等 + 多标签页连接复用。
- **冲突解决**：本地乐观更新 vs 服务器冲突（last-write-wins 或 merge）、断网操作队列恢复回放。

---

## 实施路线图（分阶段里程碑）

- **阶段 0 · 地基**（必须最先）：子项目 1（数据模型 + 迁移）→ 2（多账号 + MailAdapter + 账号 UI）；子项目 17（一行启动 + 自启）紧跟，方便迭代。
- **阶段 1 · 承载**（依赖地基，三者可并行）：3（文件夹同步）/ 4（附件）/ 5（收发补全）。
- **阶段 2 · 实时**：6（IDLE + SSE + 通知）。
- **阶段 3 · P0 收尾**：7（FTS5 搜索）/ 8（组织）/ 9（联系人）/ 10（规则）/ 11（安全收敛）——按各自依赖链。
- **阶段 4 · P1 增强**：12（AI + LLM 配置）/ 13（定时发送）/ 14（UX）/ 15（设置中心）/ 16（日历）；子项目 18（Obsidian 导出）可独立插入。
- 附加协议适配器（OAuth2/POP3/Exchange）随多账号需要提前插入（OAuth2 优先）。

每个子项目独立走 **spec → plan → 实现** 循环，按依赖排序、低耦合交付。

---

## 风险登记册

| 级别 | 风险 | 对策 |
|---|---|---|
| High | 存量库 `autoCreateTables` 不迁移 → 新表/新列静默失败运行时崩 | 子项目 1：drizzle-kit + align-baseline 先行，真实旧库验证 |
| High | body 截断三处已造成历史数据不可恢复 | 子项目 1：新库存全量 + backfill 重拉回填（受保留期限） |
| High | outbox 发送失败/退信无处理（fire-and-forget） | 子项目 13：outbox 状态机 + 重试 + 退信解析 |
| High | 收件 bodyHtml 渲染 XSS | 子项目 1/11：DOMPurify 净化 |
| High | SQLite 热备份不一致 + 附件目录不一致 | §2.5：VACUUM INTO + 原子覆盖两者 |
| High | `.all()` 全量返回 + 同步 API 阻塞事件循环 | 子项目 14：分页/游标 + worker_threads |
| High | 附件 MIME 解析 OOM / 路径穿越 / ZIP 炸弹 | 子项目 4：流式解析 + 大小上限 + 文件名清洗 |
| Medium | MSN(sequence) 多账号增量不可靠 | 子项目 1/3：改 folder+UIDVALIDITY+UID |
| Medium | `no-id-${Date.now()}` 兜底永久不去重 + 重复扣 LLM | NFR 可靠性：修兜底 + 去重主键 |
| Medium | 多账号 IDLE 写入库 SQLITE_BUSY | NFR 并发：重试 + WAL |
| Medium | SSE 断线/状态追赶/多标签页 | NFR SSE 可靠性 |
| Medium | 凭据明文泄露（db/env 入 git 或云同步） | 卫生点：.gitignore + 不入未加密云同步（本地接受明文） |
| Medium | i18n/jieba 跨平台构建 | NFR：评估构建依赖 |
| Medium | 时区不一致（scheduledAt/snoozed/cron） | NFR 时区：统一 UTC 存储 |
| Low | 垃圾过滤误判不可逆 | 子项目 11：白名单学习 + 可逆 + 保留期二次确认 |

> 注：调研完备性审查另有 19 处遗漏（凭据轮换/多设备登录态/审计日志/配额限流/移动端手势/键盘可达闭环等）——其中**凭据轮换/多设备登录态/多用户审计**因本地单用户 lens 已明确 Out of scope，其余（配额/限流、移动端、键盘可达、空加载错误态、审计日志、去重、时区）已并入上文 NFR 与各子项目。

---

## 下一步

本规格经用户确认后 → 调用 **writing-plans** 把"阶段 0 地基"（子项目 1 + 2 + 17）拆成带检查点的实现计划，开始执行；后续阶段各自再走 plan→实现循环。
