// src/lib/sync/uidvalidity.ts
// UIDVALIDITY 变化检测与重新映射。
// 用 settings 表 KV 存 `uidvalidity:{accountId}:{folder}`。
// 变化时:清空该 folder 的 messages.imap_uid(防以旧 UID 重复入库),
// 返回受影响的旧 uid 列表供上层重拉重映射。

import type Database from 'better-sqlite3'

export interface UidValidityResult {
  known: boolean
  mustRemap: boolean
  staleUids?: number[]
}

function settingKey(accountId: number, folder: string) {
  return `uidvalidity:${accountId}:${folder}`
}

function upsertSetting(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function checkUidValidity(
  db: Database.Database,
  opts: { accountId: number; folder: string; uidValidity: number },
): UidValidityResult {
  const key = settingKey(opts.accountId, opts.folder)
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined

  // 首次:记录,不重映射
  if (!row) {
    upsertSetting(db, key, String(opts.uidValidity))
    return { known: false, mustRemap: false }
  }

  const prev = parseInt(row.value, 10)
  if (prev === opts.uidValidity) {
    return { known: true, mustRemap: false }
  }

  // 变化:收集旧 uid → 清空 imap_uid → 更新记录 → 通知重映射
  const stale = db
    .prepare('SELECT imap_uid FROM messages WHERE account_id = ? AND folder = ? AND imap_uid IS NOT NULL')
    .all(opts.accountId, opts.folder) as { imap_uid: number }[]
  const staleUids = stale.map((r) => r.imap_uid)

  db.prepare('UPDATE messages SET imap_uid = NULL WHERE account_id = ? AND folder = ?').run(opts.accountId, opts.folder)
  upsertSetting(db, key, String(opts.uidValidity))

  return { known: true, mustRemap: true, staleUids }
}
