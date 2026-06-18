// src/lib/snooze/index.ts
// Snooze(延后提醒)：置位/取消 + 到期扫描唤醒。plan-08 Task 6。

import type Database from 'better-sqlite3'

/** 延后多封邮件（写入 snoozed_until 为 UTC epoch ms） */
export function snoozeMessage(db: Database.Database, opts: { messageIds: number[]; until: number }): void {
  if (!opts.messageIds.length) return
  const placeholders = opts.messageIds.map(() => '?').join(',')
  db.prepare(`UPDATE messages SET snoozed_until = ? WHERE id IN (${placeholders})`).run(opts.until, ...opts.messageIds)
}

/** 取消延后（清 snoozed_until 字段） */
export function unsnoozeMessage(db: Database.Database, opts: { messageIds: number[] }): void {
  if (!opts.messageIds.length) return
  const placeholders = opts.messageIds.map(() => '?').join(',')
  db.prepare(`UPDATE messages SET snoozed_until = NULL WHERE id IN (${placeholders})`).run(...opts.messageIds)
}

export interface SnoozeAwakeResult {
  woke: number
}

/**
 * 扫描到期邮件：清 snoozed_until=NULL + 标未读(is_read=0) + 触发回调。
 * now 默认 Date.now()（UTC epoch ms）。
 */
export function runSnoozeAwake(
  db: Database.Database,
  opts: { now?: number; onDue?: (ids: number[]) => void },
): SnoozeAwakeResult {
  const now = opts.now ?? Date.now()
  const rows = db
    .prepare('SELECT id FROM messages WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?')
    .all(now) as { id: number }[]
  if (!rows.length) return { woke: 0 }

  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE messages SET snoozed_until = NULL, is_read = 0 WHERE id IN (${placeholders})`,
    ).run(...ids)
  })
  tx()

  opts.onDue?.(ids)
  return { woke: ids.length }
}
