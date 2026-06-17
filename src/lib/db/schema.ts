// src/lib/db/schema.ts

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

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
