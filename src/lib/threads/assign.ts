// src/lib/threads/assign.ts
// 入库时计算并分配 thread_id：优先 References/In-Reply-To 根 → 规范化 Subject 复用 → 回退 messageId。
// plan-08 Task 3。

import type Database from 'better-sqlite3'
import { extractRootMessageId, normalizeSubject } from '@/lib/threads/normalize'

export interface ThreadContext {
  accountId: number
  messageId: string
  subject: string | null
  inReplyTo: string | null
  references: string | null
}

/**
 * 计算 thread_id 候选值：
 * 1. 从 References/In-Reply-To 提取根 messageId，查库是否已存在 → 复用其 thread_id
 * 2. 规范化 subject，在同 account 内查是否已有同规范 subject 的邮件 → 复用其 thread_id
 * 3. 回退用根 messageId 或自身 messageId
 */
export function computeThreadId(db: Database.Database, ctx: ThreadContext): string {
  const candidate = extractRootMessageId({ inReplyTo: ctx.inReplyTo, references: ctx.references })

  // 1. 根 messageId 已入库 → 复用其 thread_id
  if (candidate) {
    const row = db
      .prepare(
        `SELECT thread_id FROM messages
         WHERE account_id = ? AND (message_id = ? OR message_id = ?)
         AND thread_id IS NOT NULL
         LIMIT 1`,
      )
      .get(ctx.accountId, candidate, `<${candidate}>`) as { thread_id: string } | undefined
    if (row?.thread_id) return row.thread_id
  }

  // 2. 规范化 subject 同 account 有先例 → 复用同规范 subject 的 thread_id
  const norm = normalizeSubject(ctx.subject)
  if (norm) {
    const rows = db
      .prepare(
        `SELECT id, subject, thread_id FROM messages
         WHERE account_id = ? AND thread_id IS NOT NULL
         ORDER BY id`,
      )
      .all(ctx.accountId) as { id: number; subject: string | null; thread_id: string }[]
    for (const r of rows) {
      if (normalizeSubject(r.subject) === norm) {
        return r.thread_id
      }
    }
  }

  // 3. 回退
  return candidate || ctx.messageId
}
