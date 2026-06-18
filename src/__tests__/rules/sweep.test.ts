// src/__tests__/rules/sweep.test.ts
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { inboxSweep } from '@/lib/rules/sweep'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT, account_id INTEGER, sender TEXT, folder TEXT, is_archived INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, received_at INTEGER)`)
  return db
}

describe('inboxSweep', () => {
  it('保留最新一封,其余归档', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES (1,'<a>',1,'news@x.com','INBOX',0,0,1000),(2,'<b>',1,'news@x.com','INBOX',0,0,2000),(3,'<c>',1,'news@x.com','INBOX',0,0,3000),(4,'<d>',1,'other@x.com','INBOX',0,0,4000)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'news@x.com', applyAction })
    expect(res.keptMessageId).toBe(3)
    expect(res.archivedIds).toEqual([1, 2])
    expect(res.archivedCount).toBe(2)
    expect((db.prepare('SELECT is_archived FROM messages WHERE id=4').get() as any).is_archived).toBe(0)
  })
  it('keep=2 保留最新两封', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES (1,'<a>',1,'n@x.com','INBOX',0,0,100),(2,'<b>',1,'n@x.com','INBOX',0,0,200),(3,'<c>',1,'n@x.com','INBOX',0,0,300)`)
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'n@x.com', keep: 2, applyAction: vi.fn().mockResolvedValue(undefined) })
    expect(res.archivedIds).toEqual([1])
  })
  it('只一封 → 不归档', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES (1,'<a>',1,'n@x.com','INBOX',0,0,100)`)
    const applyAction = vi.fn()
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'n@x.com', applyAction })
    expect(res.archivedCount).toBe(0)
    expect(applyAction).not.toHaveBeenCalled()
  })
})
