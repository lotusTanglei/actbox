// src/__tests__/labels/apply.test.ts
// TDD: 批量贴/撕标签。plan-08 Task 5。

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyLabels } from '@/lib/labels/apply'
import { createLabel } from '@/lib/labels/repo'

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
  db.exec(`CREATE TABLE message_labels (
    message_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY (message_id, label_id)
  )`)
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    account_id INTEGER,
    subject TEXT
  )`)
  return db
}

describe('applyLabels 批量贴/撕', () => {
  it('批量给多封贴多标签', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m1>',1,'s'),(2,'<m2>',1,'s')`)
    const a = createLabel(db, { accountId: 1, name: 'A' })
    const b = createLabel(db, { accountId: 1, name: 'B' })
    const stats = applyLabels(db, { messageIds: [1, 2], labelIds: [a.id, b.id], mode: 'attach' })
    expect(stats.affected).toBe(4) // 2 msg × 2 label
    expect((db.prepare('SELECT count(*) c FROM message_labels').get() as { c: number }).c).toBe(4)
  })

  it('detach 模式删除关联', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m1>',1,'s')`)
    const a = createLabel(db, { accountId: 1, name: 'A' })
    applyLabels(db, { messageIds: [1], labelIds: [a.id], mode: 'attach' })
    applyLabels(db, { messageIds: [1], labelIds: [a.id], mode: 'detach' })
    expect((db.prepare('SELECT count(*) c FROM message_labels').get() as { c: number }).c).toBe(0)
  })
})
