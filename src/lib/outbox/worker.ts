// src/lib/outbox/worker.ts — 定时发送 worker。plan-13 Task 5。
import { MailSender } from '@/lib/adapter/mail/sender'
import { transitionOutboxStatus, nextAttemptAt, MAX_OUTBOX_ATTEMPTS } from './status'
import { getRawDb } from '@/lib/db'

export interface SenderLike {
  send(p: { to: string; cc?: string; bcc?: string; subject?: string; html?: string; body?: string }): Promise<{ messageId: string }>
}

/** 退信判定:返回 'bounced'(永久,不重试) 或 'transient'(瞬态,可重试)。 */
export function classifyFailure(errMsg: string): 'bounced' | 'transient' {
  const s = errMsg || ''
  if (/\b4\d\d\b/.test(s) && !/\b5\d\d\b/.test(s)) return 'transient'
  if (/550|551|552|553|554|user unknown|no such user|does not exist|recipient (address )?rejected|mailbox (is )?full|message size exceeds|access denied|spam|blocked/i.test(s)) return 'bounced'
  return 'transient'
}

export function getSenderForAccount(accountId: number | null | undefined, db?: any): SenderLike {
  try {
    if (accountId != null && db) {
      const row = db.prepare('SELECT smtp_host, smtp_port, "user", auth_code FROM accounts WHERE id=?').get(accountId) as any
      if (row) {
        return new MailSender({ host: row.smtp_host, port: row.smtp_port, user: row.user, authCode: row.auth_code })
      }
    }
  } catch { /* accounts 表未就绪 → env 回落 */ }
  return new MailSender()
}

export interface ProcessOutboxOpts {
  db?: any
  now?: number
  senderFactory?: (accountId: number | null) => SenderLike
}

export interface ProcessResult { processed: number; sent: number; retried: number; failed: number; bounced: number }

export async function processOutbox(opts: ProcessOutboxOpts = {}): Promise<ProcessResult> {
  const db = opts.db ?? getRawDb()
  const now = opts.now ?? Date.now()
  const factory = opts.senderFactory ?? ((acct) => getSenderForAccount(acct, db))
  const result: ProcessResult = { processed: 0, sent: 0, retried: 0, failed: 0, bounced: 0 }

  const pending = db.prepare(
    "SELECT * FROM outbox WHERE status='queued' AND scheduled_at <= ? ORDER BY scheduled_at ASC"
  ).all(now) as any[]

  for (const row of pending) {
    result.processed++
    const attempts = row.attempts + 1
    db.prepare("UPDATE outbox SET status='sending', attempts=? WHERE id=?").run(attempts, row.id)
    const sender = factory(row.account_id ?? null)
    try {
      const r = await sender.send({
        to: row.to, cc: row.cc || undefined, bcc: row.bcc || undefined,
        subject: row.subject || undefined, html: row.body_html || undefined, body: row.body_html || '',
      })
      db.prepare("UPDATE outbox SET status='sent', sent_at=?, error=NULL WHERE id=?").run(Date.now(), row.id)
      // 落 messages(direction=out)
      try {
        db.prepare(
          "INSERT INTO messages (message_id, subject, sender, recipient, body, body_html, direction, is_read, processed_at) VALUES (?,?,?,?,?,?,'out',1,unixepoch())"
        ).run(r.messageId || `sent-${row.id}-${Date.now()}`, row.subject, null, row.to, row.body_html || '', row.body_html || null)
      } catch { /* messages 插入失败不阻断 */ }
      result.sent++
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      const kind = classifyFailure(errMsg)
      if (kind === 'bounced') {
        db.prepare("UPDATE outbox SET status='bounced', error=? WHERE id=?").run(errMsg, row.id)
        result.bounced++
      } else {
        const st = transitionOutboxStatus('sending', 'send_failed', { attempts, maxAttempts: MAX_OUTBOX_ATTEMPTS })
        if (st === 'failed') {
          db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(errMsg, row.id)
          result.failed++
        } else {
          const next = nextAttemptAt(attempts, now)
          db.prepare("UPDATE outbox SET status='queued', scheduled_at=?, error=? WHERE id=?").run(next, errMsg, row.id)
          result.retried++
        }
      }
    }
  }
  return result
}
