// src/__tests__/rules/match.test.ts
import { describe, it, expect } from 'vitest'
import { matchConditions } from '@/lib/rules/match'
import type { RuleMessageContext, ConditionGroup } from '@/lib/rules/types'

const ctx = (over: Partial<RuleMessageContext> = {}): RuleMessageContext => ({
  messageId: 1, accountId: 1, from: 'Alice <alice@example.com>',
  to: 'me@x.com', cc: '', subject: '周报 Q2',
  body: '本周完成 A 和 B', hasAttachment: true, sizeKb: 200, labelIds: [], ...over,
})

describe('matchConditions', () => {
  it('from contains 命中(大小写不敏感)', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: 'alice@' }] }
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('subject equals 命中', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'subject', operator: 'equals', value: '周报 q2' }] })).toBe(true)
  })
  it('body notContains 不命中', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'body', operator: 'contains', value: '不存在的内容' }] })).toBe(false)
  })
  it('hasAttachment equals true', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'hasAttachment', operator: 'equals', value: true }] })).toBe(true)
  })
  it('size gt/lt', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'size', operator: 'gt', value: 100 }] })).toBe(true)
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'size', operator: 'gt', value: 500 }] })).toBe(false)
  })
  it('label equals', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'label', operator: 'equals', value: 5 }] }
    expect(matchConditions(ctx({ labelIds: [5, 9] }), g)).toBe(true)
    expect(matchConditions(ctx({ labelIds: [9] }), g)).toBe(false)
  })
  it('正则 matchesRegex', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'subject', operator: 'matchesRegex', value: '^周报' }] })).toBe(true)
  })
  it('非法正则当不命中', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'subject', operator: 'matchesRegex', value: '(' }] })).toBe(false)
  })
  it('AND 全中才中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [
      { field: 'from', operator: 'contains', value: 'alice' }, { field: 'hasAttachment', operator: 'equals', value: true },
    ]}
    expect(matchConditions(ctx(), g)).toBe(true)
    expect(matchConditions(ctx({ hasAttachment: false }), g)).toBe(false)
  })
  it('OR 任一中即中', () => {
    const g: ConditionGroup = { combinator: 'or', conditions: [
      { field: 'subject', operator: 'contains', value: '不存在' }, { field: 'hasAttachment', operator: 'equals', value: true },
    ]}
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('空 conditions → 通配命中', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [] })).toBe(true)
  })
})
