// src/lib/rules/actions.ts — applyActions + runRulesForMessage。plan-10 Task 4。
import type { RuleAction, RuleMessageContext, Rule, ConditionGroup, RuleKind } from './types'
import { matchConditions } from './match'
import { attachLabels, detachLabel } from '@/lib/labels/repo'

export async function applyActions(db: any, args: { context: RuleMessageContext; actions: RuleAction[]; applyAction: (db: any, opts: any) => Promise<void>; send?: (m: any) => Promise<void> }): Promise<RuleAction[]> {
  const { context, actions } = args
  const applied: RuleAction[] = []
  for (const a of actions) {
    switch (a.type) {
      case 'move':
        await args.applyAction(db, { action: 'move', messageIds: [context.messageId], targetFolder: a.targetFolder })
        break
      case 'delete':
        await args.applyAction(db, { action: 'delete', messageIds: [context.messageId] })
        break
      case 'markRead':
        await args.applyAction(db, { action: 'markRead', messageIds: [context.messageId], value: true })
        break
      case 'markUnread':
        await args.applyAction(db, { action: 'markRead', messageIds: [context.messageId], value: false })
        break
      case 'star':
        await args.applyAction(db, { action: 'star', messageIds: [context.messageId], value: true })
        break
      case 'unstar':
        await args.applyAction(db, { action: 'star', messageIds: [context.messageId], value: false })
        break
      case 'label':
        if (a.labelIds?.length) attachLabels(db, { messageIds: [context.messageId], labelIds: a.labelIds })
        break
      case 'unlabel':
        if (a.labelIds?.length) for (const lid of a.labelIds) detachLabel(db, { messageId: context.messageId, labelId: lid })
        break
      case 'priority':
        db.prepare('UPDATE messages SET priority = ? WHERE id = ?').run(a.priority ?? 'normal', context.messageId)
        break
      case 'toTodo': {
        const m = db.prepare('SELECT message_id, subject, sender FROM messages WHERE id = ?').get(context.messageId) as any
        if (m) {
          db.prepare('INSERT INTO todos (title, source_message_id, source_subject, source_from) VALUES (?,?,?,?)').run(m.subject ?? '(无主题)', m.message_id, m.subject, m.sender)
          db.prepare('UPDATE messages SET todo_count = todo_count + 1 WHERE id = ?').run(context.messageId)
        }
        break
      }
      case 'forward':
        if (a.forwardTo && args.send) {
          const m = db.prepare('SELECT subject, body, body_html FROM messages WHERE id = ?').get(context.messageId) as any
          await args.send({ to: a.forwardTo, subject: `Fwd: ${m?.subject ?? ''}`, body: m?.body ?? '', bodyHtml: m?.body_html })
        }
        break
    }
    applied.push(a)
  }
  return applied
}

/* ---------- runRulesForMessage ---------- */

interface RuleRow { id: number; account_id: number; name: string; enabled: number; conditions: string; actions: string; order: number; kind: RuleKind }

function parseRule(r: RuleRow): Rule {
  return { id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind, conditions: JSON.parse(r.conditions) as ConditionGroup, actions: JSON.parse(r.actions) as RuleAction[], order: r.order }
}

export interface RuleRunResult { matchedRuleId: number | null; matchedRuleName: string | null; appliedActions: RuleAction[]; shortCircuit: 'whitelist' | 'blacklist' | null }

export async function runRulesForMessage(db: any, args: { context: RuleMessageContext; getAdapter: (id: number) => any; applyAction: (db: any, opts: any) => Promise<void>; send?: (m: any) => Promise<void> }): Promise<RuleRunResult> {
  const { context } = args
  const rows = db.prepare(`SELECT * FROM rules WHERE account_id = ? AND enabled = 1 ORDER BY "order" ASC, id ASC`).all(context.accountId) as RuleRow[]
  const rules = rows.map(parseRule)
  const whitelist = rules.filter(r => r.kind === 'whitelist')
  const blacklist = rules.filter(r => r.kind === 'blacklist')
  const normal = rules.filter(r => r.kind === 'normal')

  for (const r of whitelist) {
    if (matchConditions(context, r.conditions)) return { matchedRuleId: null, matchedRuleName: null, appliedActions: [], shortCircuit: 'whitelist' }
  }
  for (const r of blacklist) {
    if (matchConditions(context, r.conditions)) {
      const applied = await applyActions(db, { context, actions: r.actions.length ? r.actions : [{ type: 'delete' }], applyAction: args.applyAction, send: args.send })
      return { matchedRuleId: r.id, matchedRuleName: r.name, appliedActions: applied, shortCircuit: 'blacklist' }
    }
  }
  for (const r of normal) {
    if (matchConditions(context, r.conditions)) {
      const applied = await applyActions(db, { context, actions: r.actions, applyAction: args.applyAction, send: args.send })
      return { matchedRuleId: r.id, matchedRuleName: r.name, appliedActions: applied, shortCircuit: null }
    }
  }
  return { matchedRuleId: null, matchedRuleName: null, appliedActions: [], shortCircuit: null }
}
