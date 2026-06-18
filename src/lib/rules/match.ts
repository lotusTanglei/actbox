// src/lib/rules/match.ts — matchConditions 纯函数。plan-10 Task 3。
import type { ConditionGroup, RuleCondition, RuleMessageContext, RuleOperator } from './types'

function asString(v: unknown): string { if (v == null) return ''; return String(v).toLowerCase() }

function applyStringOp(haystack: string, op: RuleOperator, needle: string): boolean {
  switch (op) {
    case 'contains': return haystack.includes(needle)
    case 'notContains': return !haystack.includes(needle)
    case 'equals': return haystack === needle
    case 'startsWith': return haystack.startsWith(needle)
    case 'endsWith': return haystack.endsWith(needle)
    case 'matchesRegex': try { return new RegExp(needle).test(haystack) } catch { return false }
    default: return false
  }
}

function evalCondition(ctx: RuleMessageContext, c: RuleCondition): boolean {
  const v = c.value
  switch (c.field) {
    case 'from': return applyStringOp(asString(ctx.from), c.operator, asString(v))
    case 'to': return applyStringOp(asString(ctx.to), c.operator, asString(v))
    case 'cc': return applyStringOp(asString(ctx.cc), c.operator, asString(v))
    case 'subject': return applyStringOp(asString(ctx.subject), c.operator, asString(v))
    case 'body': return applyStringOp(asString(ctx.body), c.operator, asString(v))
    case 'hasAttachment': return ctx.hasAttachment === Boolean(v)
    case 'size': {
      const threshold = Number(v)
      if (c.operator === 'gt') return ctx.sizeKb > threshold
      if (c.operator === 'lt') return ctx.sizeKb < threshold
      return applyStringOp(String(ctx.sizeKb), c.operator, String(threshold))
    }
    case 'label': {
      const labelId = Number(v)
      const hit = ctx.labelIds.includes(labelId)
      return c.operator === 'notContains' ? !hit : hit
    }
    default: return false
  }
}

export function matchConditions(ctx: RuleMessageContext, group: ConditionGroup): boolean {
  if (!group.conditions || group.conditions.length === 0) return true
  const results = group.conditions.map((c) => evalCondition(ctx, c))
  return group.combinator === 'or' ? results.some(Boolean) : results.every(Boolean)
}
