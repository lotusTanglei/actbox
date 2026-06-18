// src/__tests__/rules/list.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { addToList, listWhitelist, listBlacklist, removeFromList, isWhitelisted } from '@/lib/rules/list'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT, enabled INTEGER DEFAULT 1, conditions TEXT, actions TEXT, "order" INTEGER DEFAULT 0, kind TEXT DEFAULT 'normal', created_at INTEGER)`)
  return db
}

describe('whitelist/blacklist helpers', () => {
  it('addToList whitelist 建 from contains 规则', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'boss@x.com' })
    const wl = listWhitelist(db, 1)
    expect(wl).toHaveLength(1)
    expect(wl[0].conditions.conditions[0]).toMatchObject({ field: 'from', operator: 'contains', value: 'boss@x.com' })
  })
  it('addToList blacklist → listBlacklist', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'blacklist', email: 'spam@x.com' })
    expect(listBlacklist(db, 1)).toHaveLength(1)
  })
  it('removeFromList 按 id 删', () => {
    const db = memDb()
    const id = addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    removeFromList(db, id)
    expect(listWhitelist(db, 1)).toHaveLength(0)
  })
  it('isWhitelisted: from 命中→true', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'vip@x.com' })
    expect(isWhitelisted(db, { accountId: 1, from: 'VIP <vip@x.com>' })).toBe(true)
    expect(isWhitelisted(db, { accountId: 1, from: 'other@x.com' })).toBe(false)
  })
  it('同 email 重复 add 不产生重复规则', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    expect(listWhitelist(db, 1)).toHaveLength(1)
  })
})
