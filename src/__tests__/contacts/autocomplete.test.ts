// src/__tests__/contacts/autocomplete.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { autocomplete } from '@/lib/contacts/autocomplete'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, note TEXT, avatar_path TEXT, group_id INTEGER, contact_count INTEGER NOT NULL DEFAULT 0, last_contacted_at INTEGER)`)
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, account_id INTEGER, subject TEXT, sender TEXT, "to" TEXT, cc TEXT, bcc TEXT)`)
  return db
}

describe('autocomplete', () => {
  it('通讯录匹配 + 历史匹配合并，通讯录置顶', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, "to", cc, bcc) VALUES
      (1,'<m1>',1,'s','历史人 <hist@x.com>','me@x.com',NULL,NULL),
      (2,'<m2>',1,'s','hist@x.com','me@x.com',NULL,NULL),
      (3,'<m3>',1,'s','other@y.com',NULL,NULL,NULL)`)
    db.exec(`INSERT INTO contacts (id, account_id, name, email, contact_count) VALUES (10,1,'通讯录人','ab@x.com',5)`)
    const r = autocomplete(db, { accountId: 1, q: 'x.com', limit: 8 })
    const emails = r.map(x => x.email)
    expect(emails).toContain('ab@x.com')
    expect(emails).toContain('hist@x.com')
    expect(emails.indexOf('ab@x.com')).toBeLessThan(emails.indexOf('hist@x.com'))
  })

  it('同一 email 通讯录+历史都有 → source=both 且 weight=count+freq', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, "to") VALUES
      (1,'<m1>',1,'dup@x.com','me'),(2,'<m2>',1,'dup@x.com','me')`)
    db.exec(`INSERT INTO contacts (id, account_id, name, email, contact_count) VALUES (1,1,'Dup','dup@x.com',3)`)
    const r = autocomplete(db, { accountId: 1, q: 'dup' })
    expect(r[0].source).toBe('both')
    expect(r[0].weight).toBe(5)
    expect(r[0].inAddressBook).toBe(true)
  })

  it('limit 截断', () => {
    const db = memDb()
    for (let i = 0; i < 20; i++) db.exec(`INSERT INTO contacts (account_id,name,email) VALUES (1,'n${i}','e${i}@x.com')`)
    expect(autocomplete(db, { accountId: 1, q: 'x.com', limit: 8 })).toHaveLength(8)
  })

  it('空 q → 返回最近常用', () => {
    const db = memDb()
    db.exec(`INSERT INTO contacts (account_id,name,email,contact_count) VALUES (1,'A','a@x.com',2)`)
    expect(autocomplete(db, { accountId: 1, q: '', limit: 8 })[0].email).toBe('a@x.com')
  })
})
