// src/__tests__/outbox/worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { processOutbox, classifyFailure } from '@/lib/outbox/worker'

function rawDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, "to" TEXT NOT NULL, cc TEXT, bcc TEXT, subject TEXT, body_html TEXT, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER, sent_at INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, subject TEXT, sender TEXT, recipient TEXT, body TEXT, body_html TEXT, received_at INTEGER, processed_at INTEGER NOT NULL, direction TEXT NOT NULL DEFAULT 'in', is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0, todo_count INTEGER NOT NULL DEFAULT 0);
  `)
  return db
}

const mkSender = (ok: boolean, err?: any) => ({
  send: ok
    ? vi.fn().mockResolvedValue({ messageId: '<sent-1@x>' })
    : vi.fn().mockRejectedValue(err ?? new Error('boom')),
})

describe('classifyFailure', () => {
  it('550/User unknown → bounced', () => {
    expect(classifyFailure('550 User unknown')).toBe('bounced')
    expect(classifyFailure('recipient rejected')).toBe('bounced')
  })
  it('网络/超时 → transient', () => {
    expect(classifyFailure('connect ETIMEDOUT')).toBe('transient')
    expect(classifyFailure('451 timeout')).toBe('transient')
  })
  it('552 mailbox full → bounced', () => {
    expect(classifyFailure('552 mailbox is full')).toBe('bounced')
  })
})

describe('processOutbox', () => {
  it('到点的 queued → 发送成功 → sent + 落 messages', async () => {
    const db = rawDb()
    const now = Date.now()
    db.prepare("INSERT INTO outbox (\"to\",subject,body_html,scheduled_at,status,attempts) VALUES (?,?,?,?,?,0)").run('a@b.com', 'S', '<p>hi</p>', now - 1000, 'queued')
    const r = await processOutbox({ db, now, senderFactory: () => mkSender(true) as any })
    expect(r.sent).toBe(1)
    const row = db.prepare('SELECT status, sent_at FROM outbox WHERE id=1').get() as any
    expect(row.status).toBe('sent')
    expect(row.sent_at).toBeGreaterThan(0)
  })
  it('未到点的不发', async () => {
    const db = rawDb()
    db.prepare("INSERT INTO outbox (\"to\",scheduled_at,status) VALUES ('a@b',?, 'queued')").run(Date.now() + 60_000)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(true) as any })
    expect(r.sent).toBe(0)
  })
  it('瞬态失败 → 回 queued + 退避', async () => {
    const db = rawDb()
    const now = Date.now()
    db.prepare("INSERT INTO outbox (\"to\",scheduled_at,status,attempts) VALUES ('a@b',?,'queued',0)").run(now - 1)
    const r = await processOutbox({ db, now, senderFactory: () => mkSender(false, new Error('ETIMEDOUT')) as any })
    expect(r.retried).toBe(1)
    const row = db.prepare('SELECT status, attempts, scheduled_at, error FROM outbox WHERE id=1').get() as any
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(1)
    expect(row.scheduled_at).toBeGreaterThan(now)
  })
  it('退信 → bounced 不重试', async () => {
    const db = rawDb()
    db.prepare("INSERT INTO outbox (\"to\",scheduled_at,status) VALUES ('a@b',?,'queued')").run(Date.now() - 1)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(false, new Error('550 User unknown')) as any })
    expect(r.bounced).toBe(1)
    expect((db.prepare('SELECT status FROM outbox WHERE id=1').get() as any).status).toBe('bounced')
  })
  it('attempts 达上限 → failed', async () => {
    const db = rawDb()
    db.prepare("INSERT INTO outbox (\"to\",scheduled_at,status,attempts) VALUES ('a@b',?,'queued',5)").run(Date.now() - 1)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(false) as any })
    expect(r.failed).toBe(1)
  })
})
