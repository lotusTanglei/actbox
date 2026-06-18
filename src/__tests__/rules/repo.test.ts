// src/__tests__/rules/repo.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createRule, listRules, updateRule, deleteRule, setEnabled, reorderRules, getRule } from '@/lib/rules/repo'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, enabled INTEGER DEFAULT 1, conditions TEXT NOT NULL, actions TEXT NOT NULL, "order" INTEGER DEFAULT 0, kind TEXT DEFAULT 'normal', created_at INTEGER)`)
  return db
}

describe('rules repo', () => {
  it('createRule + listRules 按 order 升序', () => {
    const db = memDb()
    createRule(db, { accountId: 1, name: 'R2', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 2, kind: 'normal' })
    createRule(db, { accountId: 1, name: 'R1', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1, kind: 'normal' })
    expect(listRules(db, 1).map(r => r.name)).toEqual(['R1', 'R2'])
  })
  it('getRule 解析 JSON', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'or', conditions: [{ field: 'from', operator: 'contains', value: 'x' }] }, actions: [{ type: 'star' }], order: 0, kind: 'normal' })
    const r = getRule(db, id)
    expect(r!.conditions.combinator).toBe('or')
    expect(r!.actions[0].type).toBe('star')
  })
  it('updateRule 改 name/actions', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    updateRule(db, id, { name: 'R2', actions: [{ type: 'markRead' }] })
    expect(getRule(db, id)!.name).toBe('R2')
    expect(getRule(db, id)!.actions[0].type).toBe('markRead')
  })
  it('setEnabled 切换', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    setEnabled(db, id, false)
    expect(getRule(db, id)!.enabled).toBe(false)
  })
  it('deleteRule 删除', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    deleteRule(db, id)
    expect(getRule(db, id)).toBeNull()
  })
  it('reorderRules 批量改 order', () => {
    const db = memDb()
    const a = createRule(db, { accountId: 1, name: 'A', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    const b = createRule(db, { accountId: 1, name: 'B', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1, kind: 'normal' })
    reorderRules(db, [{ id: a, order: 1 }, { id: b, order: 0 }])
    expect(getRule(db, a)!.order).toBe(1)
    expect(getRule(db, b)!.order).toBe(0)
  })
})
