// src/lib/labels/repo.ts
// 标签与邮件-标签关联的 CRUD。plan-08 Task 4。

import type Database from 'better-sqlite3'

export interface LabelRow {
  id: number
  accountId: number
  parentId: number | null
  name: string
  color: string
}

export interface CreateLabelInput {
  accountId: number
  name: string
  color?: string
  parentId?: number | null
}

export interface UpdateLabelInput {
  name?: string
  color?: string
  parentId?: number | null
}

/** 创建标签；(account_id,name) 唯一，重复返回既有（不覆盖 color） */
export function createLabel(db: Database.Database, input: CreateLabelInput): LabelRow {
  const color = input.color || '#6b7280'
  // INSERT OR IGNORE (冲突不插入也不报错)
  db.prepare(
    `INSERT OR IGNORE INTO labels (account_id, name, color, parent_id)
     VALUES (?, ?, ?, ?)`,
  ).run(input.accountId, input.name, color, input.parentId ?? null)

  // 查出（可能是新插入，也可能是既有）
  const row = db
    .prepare('SELECT * FROM labels WHERE account_id = ? AND name = ?')
    .get(input.accountId, input.name) as any
  return {
    id: row.id,
    accountId: row.account_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    color: row.color,
  }
}

/** 列出某账号所有标签（含 parentId/color） */
export function listLabels(db: Database.Database, accountId: number): LabelRow[] {
  const rows = db
    .prepare('SELECT * FROM labels WHERE account_id = ? ORDER BY id')
    .all(accountId) as any[]
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    parentId: r.parent_id ?? null,
    name: r.name,
    color: r.color,
  }))
}

/** 更新标签（改名/改色/改父），返回更新后的行 */
export function updateLabel(db: Database.Database, id: number, patch: UpdateLabelInput): LabelRow | null {
  const sets: string[] = []
  const vals: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
  if (patch.color !== undefined) { sets.push('color = ?'); vals.push(patch.color) }
  if (patch.parentId !== undefined) { sets.push('parent_id = ?'); vals.push(patch.parentId) }
  if (sets.length === 0) {
    const r = db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as any
    if (!r) return null
    return { id: r.id, accountId: r.account_id, parentId: r.parent_id ?? null, name: r.name, color: r.color }
  }
  vals.push(id)
  db.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  const r = db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as any
  if (!r) return null
  return { id: r.id, accountId: r.account_id, parentId: r.parent_id ?? null, name: r.name, color: r.color }
}

/** 删除标签（级联删除 message_labels 关联）。返回 deleted 数量 */
export function deleteLabel(db: Database.Database, id: number): number {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM message_labels WHERE label_id = ?').run(id)
    const info = db.prepare('DELETE FROM labels WHERE id = ?').run(id)
    return info.changes
  })
  return tx() as number
}

/** 给多封邮件贴多个标签（幂等 INSERT OR IGNORE） */
export function attachLabels(db: Database.Database, opts: { messageIds: number[]; labelIds: number[] }): void {
  const tx = db.transaction(() => {
    for (const mid of opts.messageIds) {
      for (const lid of opts.labelIds) {
        db.prepare('INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?, ?)').run(mid, lid)
      }
    }
  })
  tx()
}

/** 解除某封邮件的某标签关联 */
export function detachLabel(db: Database.Database, opts: { messageId: number; labelId: number }): void {
  db.prepare('DELETE FROM message_labels WHERE message_id = ? AND label_id = ?').run(opts.messageId, opts.labelId)
}

/** 查询某封邮件贴了哪些标签 */
export function labelsOf(db: Database.Database, messageId: number): LabelRow[] {
  const rows = db
    .prepare(
      `SELECT l.* FROM labels l
       JOIN message_labels ml ON ml.label_id = l.id
       WHERE ml.message_id = ?`,
    )
    .all(messageId) as any[]
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    parentId: r.parent_id ?? null,
    name: r.name,
    color: r.color,
  }))
}
