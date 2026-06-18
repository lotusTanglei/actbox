// src/__tests__/labels/repo.test.ts
// TDD: labels/message_labels CRUD repo。plan-08 Task 4。

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createLabel, listLabels, updateLabel, deleteLabel, attachLabels, detachLabel, labelsOf } from '@/lib/labels/repo'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    parent_id INTEGER,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280'
  )`)
  db.exec(`CREATE UNIQUE INDEX uq_labels_account_name ON labels(account_id, name)`)
  db.exec(`CREATE INDEX idx_labels_account_parent ON labels(account_id, parent_id)`)
  db.exec(`CREATE TABLE message_labels (
    message_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY (message_id, label_id)
  )`)
  db.exec(`CREATE INDEX idx_message_labels_label ON message_labels(label_id)`)
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    account_id INTEGER,
    subject TEXT
  )`)
  return db
}

describe('labels repo', () => {
  it('createLabel 唯一(account_id,name) 重复返回既有', () => {
    const db = memDb()
    const a = createLabel(db, { accountId: 1, name: '重要', color: '#ef4444' })
    const b = createLabel(db, { accountId: 1, name: '重要', color: '#000' })
    expect(a.id).toBe(b.id)
    expect(b.color).toBe('#ef4444') // 不覆盖
  })

  it('attachLabels 幂等 + labelsOf 返回', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const lab = createLabel(db, { accountId: 1, name: 'L1' })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] }) // 幂等
    const ls = labelsOf(db, 1)
    expect(ls.map(l => l.name)).toEqual(['L1'])
  })

  it('detachLabel 删除关联', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const lab = createLabel(db, { accountId: 1, name: 'L1' })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] })
    detachLabel(db, { messageId: 1, labelId: lab.id })
    expect(labelsOf(db, 1)).toHaveLength(0)
  })

  it('listLabels 按 account 含 parentId 嵌套', () => {
    const db = memDb()
    const p = createLabel(db, { accountId: 1, name: 'P' })
    createLabel(db, { accountId: 1, name: 'C', parentId: p.id })
    const ls = listLabels(db, 1)
    expect(ls).toHaveLength(2)
    expect(ls.find(l => l.name === 'C')?.parentId).toBe(p.id)
  })

  it('updateLabel 改名/改色', () => {
    const db = memDb()
    const lab = createLabel(db, { accountId: 1, name: '旧名' })
    const updated = updateLabel(db, lab.id, { name: '新名', color: '#00ff00' })
    expect(updated?.name).toBe('新名')
    expect(updated?.color).toBe('#00ff00')
  })

  it('deleteLabel 级联删关联', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const lab = createLabel(db, { accountId: 1, name: 'L' })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] })
    deleteLabel(db, lab.id)
    expect(listLabels(db, 1)).toHaveLength(0)
    expect(db.prepare('SELECT count(*) c FROM message_labels').get() as { c: number }).toEqual({ c: 0 })
  })
})
