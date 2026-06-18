// src/lib/rules/list.ts — 白/黑名单便捷 helpers。plan-10 Task 6。
import type { Rule, RuleKind } from './types'
import { createRule, listRules, deleteRule, nextOrder } from './repo'
import { matchConditions } from './match'

function fromContains(email: string) {
  return { combinator: 'and' as const, conditions: [{ field: 'from' as const, operator: 'contains' as const, value: email.toLowerCase() }] }
}

export function addToList(db: any, input: { accountId: number; kind: 'whitelist' | 'blacklist'; email: string }): number {
  const email = input.email.toLowerCase().trim()
  const existing = listRules(db, input.accountId).filter(r => r.kind === input.kind)
  const dup = existing.find(r => r.conditions.conditions.some(c => c.field === 'from' && String(c.value).toLowerCase() === email))
  if (dup) return dup.id
  return createRule(db, { accountId: input.accountId, name: `${input.kind === 'whitelist' ? '白名单' : '黑名单'}: ${email}`, conditions: fromContains(email), actions: input.kind === 'blacklist' ? [{ type: 'delete' }] : [], order: nextOrder(db, input.accountId), kind: input.kind as RuleKind })
}

export function listWhitelist(db: any, accountId: number): Rule[] { return listRules(db, accountId).filter(r => r.kind === 'whitelist') }
export function listBlacklist(db: any, accountId: number): Rule[] { return listRules(db, accountId).filter(r => r.kind === 'blacklist') }
export function removeFromList(db: any, id: number): void { deleteRule(db, id) }

export function isWhitelisted(db: any, input: { accountId: number; from: string }): boolean {
  return listWhitelist(db, input.accountId).some(r => matchConditions({ messageId: 0, accountId: input.accountId, from: input.from, to: '', cc: '', subject: '', body: '', hasAttachment: false, sizeKb: 0, labelIds: [] }, r.conditions))
}
