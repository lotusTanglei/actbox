// src/__tests__/snooze/snooze.test.ts
// TDD: Snooze 置位/取消 + 到期唤醒。plan-08 Task 6。

import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { snoozeMessage, unsnoozeMessage, runSnoozeAwake } from '@/lib/snooze'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    account_id INTEGER,
    subject TEXT,
    snoozed_until INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0
  )`)
  return db
}

describe('Snooze', () => {
  it('snoozeMessage 置 snoozed_until (UTC epoch ms)', () => {
    const db = memDb()
    const until = Date.now() + 3600_000
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    snoozeMessage(db, { messageIds: [1], until })
    const row = db.prepare('SELECT snoozed_until FROM messages WHERE id=1').get() as any
    expect(row.snoozed_until).toBe(until)
  })

  it('unsnoozeMessage 清字段', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, snoozed_until) VALUES (1,'<m>',1,'s',${Date.now() + 1000})`)
    unsnoozeMessage(db, { messageIds: [1] })
    const row = db.prepare('SELECT snoozed_until FROM messages WHERE id=1').get() as any
    expect(row.snoozed_until).toBeNull()
  })

  it('runSnoozeAwake 到期邮件清字段+标未读+触发回调', () => {
    const db = memDb()
    const past = Date.now() - 1000
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, snoozed_until, is_read) VALUES (1,'<m>',1,'s',${past},1),(2,'<m2>',1,'s',${Date.now() + 9999},1)`)
    const onDue = vi.fn()
    const stats = runSnoozeAwake(db, { now: Date.now(), onDue })
    expect(stats.woke).toBe(1)
    const r = db.prepare('SELECT snoozed_until, is_read FROM messages WHERE id=1').get() as any
    expect(r.snoozed_until).toBeNull()
    expect(r.is_read).toBe(0) // 标未读提醒
    expect(onDue).toHaveBeenCalledWith([1])
    // 未到期的不动
    const r2 = db.prepare('SELECT snoozed_until FROM messages WHERE id=2').get() as any
    expect(r2.snoozed_until).not.toBeNull()
  })
})
