// src/__tests__/contacts/repo.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  createContact, upsertByEmail, getContact, updateContact, deleteContact,
  listContacts, bumpContact, createGroup, listGroups, groupMembers, deleteGroup,
} from '@/lib/contacts/repo'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, note TEXT, avatar_path TEXT, group_id INTEGER, contact_count INTEGER NOT NULL DEFAULT 0, last_contacted_at INTEGER)`)
  db.exec(`CREATE UNIQUE INDEX uq_contacts_account_email ON contacts(account_id, email)`)
  db.exec(`CREATE INDEX idx_contacts_account_name ON contacts(account_id, name)`)
  db.exec(`CREATE INDEX idx_contacts_account_group ON contacts(account_id, group_id)`)
  db.exec(`CREATE TABLE contacts_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL)`)
  db.exec(`CREATE UNIQUE INDEX uq_contacts_groups_account_name ON contacts_groups(account_id, name)`)
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, account_id INTEGER, subject TEXT, sender TEXT, recipient TEXT)`)
  return db
}

describe('contacts repo', () => {
  it('createContact 唯一(account,email) 冲突返回既有', () => {
    const db = memDb()
    const a = createContact(db, { accountId: 1, name: '张三', email: 'z@x.com' })
    const b = createContact(db, { accountId: 1, name: '张三丰', email: 'z@x.com' })
    expect(a.id).toBe(b.id)
    expect(b.name).toBe('张三')
  })
  it('upsertByEmail 新建返回 {created:true}', () => {
    const db = memDb()
    const r = upsertByEmail(db, { accountId: 1, email: 'new@x.com', name: 'New' })
    expect(r.created).toBe(true)
    expect(r.contact.email).toBe('new@x.com')
  })
  it('upsertByEmail 既有且 name 非空 → 更新 name，返回 created:false', () => {
    const db = memDb()
    createContact(db, { accountId: 1, name: '', email: 'e@x.com' })
    const r = upsertByEmail(db, { accountId: 1, email: 'e@x.com', name: '有了' })
    expect(r.created).toBe(false)
    expect(getContact(db, r.contact.id)!.name).toBe('有了')
  })
  it('bumpContact contact_count+1 且 lastContactedAt 更新', () => {
    const db = memDb()
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com' })
    bumpContact(db, { accountId: 1, email: 'a@x.com', name: 'A' })
    const got = getContact(db, c.id)!
    expect(got.contactCount).toBe(1)
    expect(got.lastContactedAt).not.toBeNull()
  })
  it('bumpContact 不存在则 upsert 新建并 count=1', () => {
    const db = memDb()
    const r = bumpContact(db, { accountId: 1, email: 'fresh@x.com', name: 'Fresh' })
    expect(r.contact.contactCount).toBe(1)
  })
  it('分组 + groupMembers', () => {
    const db = memDb()
    const g = createGroup(db, { accountId: 1, name: '团队' })
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com', groupId: g.id })
    expect(groupMembers(db, g.id).map(m => m.id)).toContain(c.id)
  })
  it('deleteGroup 解除关联保留联系人 (group_id=NULL)', () => {
    const db = memDb()
    const g = createGroup(db, { accountId: 1, name: '团队' })
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com', groupId: g.id })
    deleteGroup(db, g.id)
    expect(getContact(db, c.id)!.groupId).toBeNull()
    expect(listGroups(db, 1)).toHaveLength(0)
  })
  it('listContacts 按 q 搜索 name/email', () => {
    const db = memDb()
    createContact(db, { accountId: 1, name: '张三', email: 'z@x.com' })
    createContact(db, { accountId: 1, name: '李四', email: 'ls@y.com' })
    expect(listContacts(db, 1, { q: '张' })).toHaveLength(1)
    expect(listContacts(db, 1, { q: '@y.com' })).toHaveLength(1)
  })
})
