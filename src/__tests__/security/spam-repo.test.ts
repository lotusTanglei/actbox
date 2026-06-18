// src/__tests__/security/spam-repo.test.ts
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { markAsSpam, unmarkSpam, reportSpam, isWhitelistedSender, addSpamWhitelist } from '@/lib/security/spam-repo'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT, account_id INTEGER, sender TEXT, subject TEXT, body TEXT, folder TEXT DEFAULT 'INBOX', imap_uid INTEGER, is_spam INTEGER DEFAULT 0)`)
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`)
  return db
}

describe('spam-repo', () => {
  it('markAsSpam: is_spam=1 + 移 Spam', async () => {
    const db = memDb(); db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, folder, imap_uid) VALUES (1,'<m>',1,'a@b','s','INBOX',1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await markAsSpam(db, { messageId: 1, moveToSpam: move })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
    expect(move).toHaveBeenCalledWith(db, expect.objectContaining({ targetFolder: 'Spam' }))
  })
  it('unmarkSpam: 恢复 + 加白名单', async () => {
    const db = memDb(); db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, folder, imap_uid, is_spam) VALUES (1,'<m>',1,'vip@corp.com','s','Spam',1,1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await unmarkSpam(db, { messageId: 1, moveToFolder: move })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(0)
    expect(isWhitelistedSender(db, 'vip@corp.com')).toBe(true)
  })
  it('addSpamWhitelist 去重', () => { const db = memDb(); addSpamWhitelist(db, 'a@b.com'); addSpamWhitelist(db, 'a@b.com'); expect(isWhitelistedSender(db, 'a@b.com')).toBe(true) })
  it('reportSpam: 标记 + 学习', async () => {
    const db = memDb(); db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, folder, imap_uid) VALUES (1,'<m>',1,'spam@x','低价代开','低价代开发票','INBOX',1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await reportSpam(db, { messageId: 1, moveToSpam: move })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
  })
})
