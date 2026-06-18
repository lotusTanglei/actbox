// src/lib/sync/retention.ts
// 垃圾箱/已删除保留期到期清除:is_deleted=1 且删除时间(archived_at,缺省 processed_at)
// 超过 retentionDays → adapter.delete(uid,folder) 回写彻底删除 + 物理删本地行。
// 单条失败不删本地、记日志,下次重试。

import type Database from 'better-sqlite3'
import type { MailAdapter } from '@/lib/adapter/types'

export interface PurgeResult {
  purged: number
  attempted: number
  failed: number
}

export async function purgeExpiredDeleted(
  db: Database.Database,
  opts: { adapter: MailAdapter; retentionDays?: number },
): Promise<PurgeResult> {
  const retentionDays = opts.retentionDays ?? 30
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400

  const rows = db
    .prepare(
      `SELECT id, account_id, folder, imap_uid
       FROM messages
       WHERE is_deleted = 1 AND COALESCE(archived_at, processed_at) < ?`,
    )
    .all(cutoff) as { id: number; account_id: number; folder: string; imap_uid: number | null }[]

  let purged = 0
  let failed = 0
  for (const r of rows) {
    try {
      if (r.imap_uid != null) await opts.adapter.delete(r.imap_uid, r.folder)
      db.prepare('DELETE FROM messages WHERE id = ?').run(r.id)
      purged++
    } catch (e) {
      failed++
      console.error(`[retention] purge failed id=${r.id}:`, e instanceof Error ? e.message : e)
      // 不删本地,下次重试
    }
  }

  return { purged, attempted: rows.length, failed }
}
