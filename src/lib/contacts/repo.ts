// src/lib/contacts/repo.ts
// 联系人/分组 CRUD + upsertByEmail + bumpContact。plan-09 Task 2。

import type Database from 'better-sqlite3'

/* ---------- 类型 ---------- */
export interface ContactRow {
  id: number
  accountId: number
  name: string
  email: string
  phone: string | null
  note: string | null
  avatarPath: string | null
  groupId: number | null
  contactCount: number
  lastContactedAt: number | null
}

export interface GroupRow {
  id: number
  accountId: number
  name: string
}

export interface CreateContactInput {
  accountId: number
  name: string
  email: string
  phone?: string
  note?: string
  avatarPath?: string
  groupId?: number | null
}

/* ---------- 联系人 ---------- */

export function createContact(db: Database.Database, input: CreateContactInput): ContactRow {
  db.prepare(
    `INSERT OR IGNORE INTO contacts (account_id, name, email, phone, note, avatar_path, group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.accountId, input.name, input.email.toLowerCase().trim(), input.phone ?? null, input.note ?? null, input.avatarPath ?? null, input.groupId ?? null)

  return getByEmail(db, input.accountId, input.email)!
}

export function upsertByEmail(db: Database.Database, opts: { accountId: number; email: string; name: string }): { created: boolean; contact: ContactRow } {
  const existing = getByEmail(db, opts.accountId, opts.email)
  if (existing) {
    // name 非空且现 name 为空时更新
    if (opts.name && !existing.name) {
      db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(opts.name, existing.id)
      existing.name = opts.name
    }
    return { created: false, contact: existing }
  }
  const c = createContact(db, { accountId: opts.accountId, name: opts.name, email: opts.email })
  return { created: true, contact: c }
}

export function bumpContact(db: Database.Database, opts: { accountId: number; email: string; name: string }): { contact: ContactRow } {
  const tx = db.transaction(() => {
    const { contact } = upsertByEmail(db, opts)
    const now = Date.now()
    db.prepare(
      'UPDATE contacts SET contact_count = contact_count + 1, last_contacted_at = ? WHERE id = ?',
    ).run(now, contact.id)
    return getById(db, contact.id)!
  })
  return { contact: tx() }
}

export function getContact(db: Database.Database, id: number): ContactRow | null {
  return getById(db, id)
}

export function updateContact(db: Database.Database, id: number, patch: Partial<Pick<ContactRow, 'name' | 'email' | 'phone' | 'note' | 'avatarPath' | 'groupId'>>): ContactRow | null {
  const sets: string[] = []
  const vals: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
  if (patch.email !== undefined) { sets.push('email = ?'); vals.push(patch.email.toLowerCase().trim()) }
  if (patch.phone !== undefined) { sets.push('phone = ?'); vals.push(patch.phone) }
  if (patch.note !== undefined) { sets.push('note = ?'); vals.push(patch.note) }
  if (patch.avatarPath !== undefined) { sets.push('avatar_path = ?'); vals.push(patch.avatarPath) }
  if (patch.groupId !== undefined) { sets.push('group_id = ?'); vals.push(patch.groupId) }
  if (sets.length === 0) return getById(db, id)
  vals.push(id)
  db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getById(db, id)
}

export function deleteContact(db: Database.Database, id: number): number {
  return db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes
}

export function listContacts(db: Database.Database, accountId: number, opts?: { groupId?: number; q?: string }): ContactRow[] {
  let sql = 'SELECT * FROM contacts WHERE account_id = ?'
  const vals: any[] = [accountId]
  if (opts?.groupId != null) { sql += ' AND group_id = ?'; vals.push(opts.groupId) }
  if (opts?.q?.trim()) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)'; const like = `%${opts.q.trim().toLowerCase()}%`; vals.push(like, like) }
  sql += ' ORDER BY contact_count DESC, last_contacted_at DESC'
  return (db.prepare(sql).all(...vals) as any[]).map(mapRow)
}

/* ---------- 分组 ---------- */

export function createGroup(db: Database.Database, opts: { accountId: number; name: string }): GroupRow {
  db.prepare('INSERT OR IGNORE INTO contacts_groups (account_id, name) VALUES (?, ?)').run(opts.accountId, opts.name)
  return db.prepare('SELECT * FROM contacts_groups WHERE account_id = ? AND name = ?').get(opts.accountId, opts.name) as any
}

export function listGroups(db: Database.Database, accountId: number): GroupRow[] {
  return db.prepare('SELECT * FROM contacts_groups WHERE account_id = ? ORDER BY id').all(accountId) as GroupRow[]
}

export function groupMembers(db: Database.Database, groupId: number): ContactRow[] {
  return (db.prepare('SELECT * FROM contacts WHERE group_id = ?').all(groupId) as any[]).map(mapRow)
}

export function deleteGroup(db: Database.Database, id: number): number {
  const tx = db.transaction(() => {
    db.prepare('UPDATE contacts SET group_id = NULL WHERE group_id = ?').run(id)
    return db.prepare('DELETE FROM contacts_groups WHERE id = ?').run(id).changes
  })
  return tx() as number
}

/* ---------- 内部 ---------- */

function getById(db: Database.Database, id: number): ContactRow | null {
  const r = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as any
  return r ? mapRow(r) : null
}

function getByEmail(db: Database.Database, accountId: number, email: string): ContactRow | null {
  const r = db.prepare('SELECT * FROM contacts WHERE account_id = ? AND email = ?').get(accountId, email.toLowerCase().trim()) as any
  return r ? mapRow(r) : null
}

function mapRow(r: any): ContactRow {
  return {
    id: r.id, accountId: r.account_id, name: r.name, email: r.email,
    phone: r.phone ?? null, note: r.note ?? null, avatarPath: r.avatar_path ?? null,
    groupId: r.group_id ?? null, contactCount: r.contact_count ?? 0,
    lastContactedAt: r.last_contacted_at ?? null,
  }
}
