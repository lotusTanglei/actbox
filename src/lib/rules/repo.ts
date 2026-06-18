// src/lib/rules/repo.ts — rules CRUD + 排序 + 启停。plan-10 Task 5。
import type { ConditionGroup, RuleAction, RuleKind, Rule } from './types'

export function createRule(db: any, input: { accountId: number; name: string; conditions: ConditionGroup; actions: RuleAction[]; order: number; kind?: RuleKind; enabled?: boolean }): number {
  const res = db.prepare(`INSERT INTO rules (account_id, name, enabled, conditions, actions, "order", kind) VALUES (?,?,?,?,?,?,?)`).run(
    input.accountId, input.name, input.enabled === false ? 0 : 1, JSON.stringify(input.conditions), JSON.stringify(input.actions), input.order, input.kind ?? 'normal')
  return Number(res.lastInsertRowid)
}

export function getRule(db: any, id: number): Rule | null {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as any
  if (!r) return null
  return { id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions), order: r.order }
}

export function listRules(db: any, accountId: number): Rule[] {
  const rows = db.prepare('SELECT * FROM rules WHERE account_id = ? ORDER BY "order" ASC, id ASC').all(accountId) as any[]
  return rows.map(r => ({ id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions), order: r.order }))
}

export function updateRule(db: any, id: number, patch: Partial<Pick<Rule, 'name' | 'conditions' | 'actions' | 'kind'>>): void {
  const cur = getRule(db, id); if (!cur) return
  db.prepare('UPDATE rules SET name = ?, conditions = ?, actions = ?, kind = ? WHERE id = ?').run(patch.name ?? cur.name, JSON.stringify(patch.conditions ?? cur.conditions), JSON.stringify(patch.actions ?? cur.actions), patch.kind ?? cur.kind, id)
}

export function setEnabled(db: any, id: number, enabled: boolean): void { db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id) }
export function deleteRule(db: any, id: number): void { db.prepare('DELETE FROM rules WHERE id = ?').run(id) }

export function reorderRules(db: any, entries: { id: number; order: number }[]): void {
  const tx = db.transaction(() => { for (const e of entries) db.prepare('UPDATE rules SET "order" = ? WHERE id = ?').run(e.order, e.id) })
  tx()
}

export function nextOrder(db: any, accountId: number): number {
  const r = db.prepare('SELECT COALESCE(MAX("order"), -1) + 1 AS o FROM rules WHERE account_id = ?').get(accountId) as any
  return r.o
}
