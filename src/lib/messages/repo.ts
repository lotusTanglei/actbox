// src/lib/messages/repo.ts
// 邮件行读写:upsert(按 message_id 去重)、UID 高水位(settings KV)、未读/总数重算。
// incrementalSync 等实时模块用。plan-06 Task 3。

import type Database from 'better-sqlite3'
import { htmlToText } from '@/lib/db/body-html-text'

export interface MessageUpsert {
  messageId: string
  subject?: string | null
  from?: string | null
  to?: string | null
  cc?: string | null
  bcc?: string | null
  body?: string | null
  bodyHtml?: string | null
  receivedAt?: Date | string | null
  accountId?: number | null
  folder?: string
  imapUid?: number | null
}

/** 按 message_id 去重 upsert(收件 direction='in')。返回是否为新增行。 */
export function upsertMessage(db: Database.Database, m: MessageUpsert): boolean {
  const now = Math.floor(Date.now() / 1000)
  const received = m.receivedAt ? Math.floor(new Date(m.receivedAt as string | Date).getTime() / 1000) : null
  const bodyHtmlText = m.bodyHtml ? htmlToText(m.bodyHtml) : null
  const existing = db.prepare('SELECT id FROM messages WHERE message_id = ?').get(m.messageId)
  db.prepare(
    `INSERT INTO messages
       (message_id, subject, sender, "to", cc, bcc, body, body_html, body_html_text, received_at, processed_at, direction, account_id, folder, imap_uid)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'in',?,?,?)
     ON CONFLICT(message_id) DO UPDATE SET
       subject=excluded.subject, sender=excluded.sender, "to"=excluded."to", cc=excluded.cc, bcc=excluded.bcc,
       body=excluded.body, body_html=excluded.body_html, body_html_text=excluded.body_html_text, received_at=excluded.received_at,
       account_id=excluded.account_id, folder=excluded.folder, imap_uid=excluded.imap_uid`,
  ).run(
    m.messageId,
    m.subject ?? null,
    m.from ?? null,
    m.to ?? null,
    m.cc ?? null,
    m.bcc ?? null,
    m.body ?? null,
    m.bodyHtml ?? null,
    bodyHtmlText,
    received,
    now,
    m.accountId ?? null,
    m.folder ?? 'INBOX',
    m.imapUid ?? null,
  )
  return !existing
}

/** 取某 folder 的 UID 高水位(settings `uidhigh:{acc}:{folder}`)。 */
export function lastUidHighWater(
  db: Database.Database,
  opts: { accountId: number; folder: string },
): number | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`uidhigh:${opts.accountId}:${opts.folder}`) as { value: string } | undefined
  return row ? Number(row.value) : null
}

export function setUidHighWater(
  db: Database.Database,
  opts: { accountId: number; folder: string; uid: number },
): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `uidhigh:${opts.accountId}:${opts.folder}`,
    String(opts.uid),
  )
}

/** 重算某 folder 的未读/总数(direction='in' 且未软删)。 */
export function recomputeUnread(
  db: Database.Database,
  opts: { accountId: number; folder: string },
): { unread: number; total: number } {
  const u = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE account_id = ? AND folder = ? AND is_read = 0 AND is_deleted = 0 AND direction = 'in'`,
    )
    .get(opts.accountId, opts.folder) as { c: number }
  const t = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE account_id = ? AND folder = ? AND is_deleted = 0 AND direction = 'in'`,
    )
    .get(opts.accountId, opts.folder) as { c: number }
  return { unread: u.c, total: t.c }
}
