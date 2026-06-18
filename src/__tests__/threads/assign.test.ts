// src/__tests__/threads/assign.test.ts
// TDD: 入库时计算 thread_id。plan-08 Task 3。

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { computeThreadId } from '@/lib/threads/assign'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    account_id INTEGER,
    subject TEXT,
    thread_id TEXT
  )`)
  return db
}

describe('computeThreadId', () => {
  it('有 References 根且已入库该 messageId → 复用其 thread_id', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, thread_id) VALUES (1,'root@x',1,'周报','T-weekly')`)
    const tid = computeThreadId(db, {
      accountId: 1,
      messageId: 'r2@x',
      subject: 'Re: 周报',
      inReplyTo: 'root@x',
      references: 'root@x',
    })
    expect(tid).toBe('T-weekly')
  })

  it('无根但规范化 Subject 同 account 有先例 → 复用同 subject 的 thread_id', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, thread_id) VALUES (1,'a',1,'周报','S-周报')`)
    const tid = computeThreadId(db, {
      accountId: 1,
      messageId: 'b',
      subject: 'Re: 周报',
      inReplyTo: null,
      references: null,
    })
    expect(tid).toBe('S-周报')
  })

  it('全新会话 → 用根 messageId 作 thread_id', () => {
    const db = memDb()
    const tid = computeThreadId(db, {
      accountId: 1,
      messageId: 'new',
      subject: '新主题',
      inReplyTo: null,
      references: null,
    })
    expect(tid).toBe('new')
  })

  it('规范化后为空且无根 → 用自身 messageId', () => {
    const db = memDb()
    const tid = computeThreadId(db, {
      accountId: 1,
      messageId: 'x',
      subject: '   ',
      inReplyTo: null,
      references: null,
    })
    expect(tid).toBe('x')
  })
})
