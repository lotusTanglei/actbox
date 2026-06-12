// src/lib/db/schema.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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

/** 已处理邮件记录（幂等去重用） */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject'),
  from: text('sender'),
  body: text('body'),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  processedAt: integer('processed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  direction: text('direction', { enum: ['in', 'out'] }).notNull().default('in'),
})

/** 运行配置（Phase 4 用） */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
