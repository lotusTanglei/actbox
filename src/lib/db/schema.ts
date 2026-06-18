// src/lib/db/schema.ts

import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

/** 待办表 */
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  dueDate: text('due_date'),
  priority: text('priority', { enum: ['high', 'medium', 'low'] }),
  context: text('context'),
  status: text('status', { enum: ['pending', 'done'] }).notNull().default('pending'),
  // 来源邮件信息
  sourceMessageId: text('source_message_id'),
  sourceSubject: text('source_subject'),
  sourceFrom: text('source_from'),
  // 时间戳
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

/** 邮件表（收件 + 发件 + 草稿）—— 最终版（plan-01 Task 3 扩列） */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject'),
  from: text('sender'),
  to: text('to'), // 收件人（可逗号分隔多地址）
  cc: text('cc'),
  bcc: text('bcc'),
  recipient: text('recipient'), // 旧列保留兼容（回填到 to，见 backfill）
  body: text('body'), // 清洗后全文纯文本（不再截断，见 plan-01 Task 4）
  bodyHtml: text('body_html'), // HTML 原文（完整渲染）
  bodyHtmlText: text('body_html_text'), // body_html 去标签纯文本,供 FTS 索引（plan-07 Task 2）
  accountId: integer('account_id'),
  folder: text('folder').notNull().default('INBOX'),
  imapUid: integer('imap_uid'),
  imapSeq: integer('imap_seq'),
  threadId: text('thread_id'),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp' }),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  processedAt: integer('processed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  direction: text('direction', { enum: ['in', 'out', 'draft'] }).notNull().default('in'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  // 关联待办数量（缓存，避免每次 join 查询）
  todoCount: integer('todo_count').notNull().default(0),
  // 安全列 plan-11 Task 2
  isSpam: integer('is_spam', { mode: 'boolean' }).notNull().default(false),
  authResult: text('auth_result'),              // JSON: { spf, dkim, dmarc }
  isExternal: integer('is_external', { mode: 'boolean' }).notNull().default(false),
  spamReasons: text('spam_reasons'),            // JSON: string[]
  spamScore: real('spam_score').notNull().default(0),
}, (t) => ({
  accFolderUidIdx: index('idx_messages_account_folder_uid').on(t.accountId, t.folder, t.imapUid),
  threadIdx: index('idx_messages_thread').on(t.threadId),
  accReceivedIdx: index('idx_messages_account_received').on(t.accountId, t.receivedAt),
}))

/** 运行配置 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** 邮箱账号表（多账号）—— 凭据明文存（本地单机约束，无加密）。plan-02 Task 6 */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  provider: text('provider', { enum: ['163', '126', 'qq', 'gmail', 'outlook', 'custom'] }).notNull(),
  protocol: text('protocol', { enum: ['imap', 'pop3'] }).notNull().default('imap'),
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  user: text('user').notNull(),
  authCode: text('auth_code').notNull(), // 明文（本地约束）
  oauthRefreshToken: text('oauth_refresh_token'),
  displayName: text('display_name'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  syncMode: text('sync_mode', { enum: ['idle', 'poll'] }).notNull().default('idle'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  syncStatus: text('sync_status', { enum: ['healthy', 'syncing', 'error', 'disabled'] }).notNull().default('healthy'),
  syncError: text('sync_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  activeIdx: index('idx_accounts_active').on(t.isActive),
}))

/** 邮箱文件夹表(服务器文件夹映射 + 角标)—— plan-03 Task 1 */
export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  path: text('path').notNull(), // IMAP 服务器路径,如 'INBOX' / '[Gmail]/Sent Mail'
  displayName: text('display_name').notNull(),
  type: text('type', { enum: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive', 'custom'] }).notNull().default('custom'),
  unreadCount: integer('unread_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
}, (t) => ({
  accPathUq: uniqueIndex('uq_folders_account_path').on(t.accountId, t.path),
}))

/** 附件表（内容寻址 sha256 落盘 + 引用计数去重）—— plan-04 Task 1
 *  storagePath/sha256 可空：超 perAttachment 上限的附件「记表不落盘」（storagePath=null）。
 *  scanStatus/overSizeLimit 供 Task 4 流式解析 + 病毒扫描钩子写入。 */
export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  messageId: integer('message_id').notNull(), // messages.id 外键
  filename: text('filename').notNull(), // 清洗后
  mimeType: text('mime_type'),
  size: integer('size').notNull(),
  contentId: text('content_id'), // MIME Content-ID（内联用，可空）
  isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
  storagePath: text('storage_path'), // 相对根的 sha256 内容寻址路径；超限未落盘时为 null
  sha256: text('sha256'), // 内容 sha256；未下载内容时为 null
  scanStatus: text('scan_status').notNull().default('ok'), // ok | flagged（病毒扫描钩子结果）
  scanReason: text('scan_reason'), // 钩子返回的命中原因
  overSizeLimit: integer('over_size_limit', { mode: 'boolean' }).notNull().default(false),
  downloadedAt: integer('downloaded_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  msgIdx: index('idx_attachments_message').on(t.messageId),
  shaIdx: index('idx_attachments_sha').on(t.sha256),
}))

/** 标签表（按账号隔离，支持嵌套与着色） */
export const labels = sqliteTable('labels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  parentId: integer('parent_id'),                 // 嵌套父标签 id（null=顶层）
  name: text('name').notNull(),
  color: text('color').notNull().default('#6b7280'), // 十六进制颜色
}, (t) => ({
  accNameUq: uniqueIndex('uq_labels_account_name').on(t.accountId, t.name),
  accParentIdx: index('idx_labels_account_parent').on(t.accountId, t.parentId),
}))

/** 邮件-标签关联表（多对多） */
export const messageLabels = sqliteTable('message_labels', {
  messageId: integer('message_id').notNull(),
  labelId: integer('label_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.labelId] }),
  labelIdx: index('idx_message_labels_label').on(t.labelId),
}))

/** 联系人分组/邮件组（按账号隔离） */
export const contactsGroups = sqliteTable('contacts_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
}, (t) => ({
  accNameUq: uniqueIndex('uq_contacts_groups_account_name').on(t.accountId, t.name),
}))

/** 联系人（按账号隔离，email 在账号内唯一） */
export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  note: text('note'),
  avatarPath: text('avatar_path'),
  groupId: integer('group_id'),
  contactCount: integer('contact_count').notNull().default(0),
  lastContactedAt: integer('last_contacted_at', { mode: 'timestamp' }),
}, (t) => ({
  accEmailUq: uniqueIndex('uq_contacts_account_email').on(t.accountId, t.email),
  accNameIdx: index('idx_contacts_account_name').on(t.accountId, t.name),
  accGroupIdx: index('idx_contacts_account_group').on(t.accountId, t.groupId),
}))

/** 邮件规则/过滤器（按账号隔离，order 决定匹配优先级，小在前） */
export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  conditions: text('conditions').notNull(), // JSON string
  actions: text('actions').notNull(),        // JSON string
  order: integer('order').notNull().default(0),
  kind: text('kind', { enum: ['normal', 'whitelist', 'blacklist'] }).notNull().default('normal'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  accOrderIdx: index('idx_rules_account_order').on(t.accountId, t.order),
  accKindIdx: index('idx_rules_account_kind').on(t.accountId, t.kind),
}))
