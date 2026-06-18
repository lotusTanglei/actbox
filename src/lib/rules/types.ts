// src/lib/rules/types.ts — 规则条件/动作的 TS 类型 + JSON schema 常量。plan-10 Task 2。

export type RuleOperator = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith' | 'matchesRegex' | 'gt' | 'lt'
export type ConditionField = 'from' | 'subject' | 'body' | 'hasAttachment' | 'size' | 'label' | 'to' | 'cc'
export interface RuleCondition { field: ConditionField; operator: RuleOperator; value: string | number | boolean }
export type ConditionCombinator = 'and' | 'or'
export interface ConditionGroup { combinator: ConditionCombinator; conditions: RuleCondition[] }

export type ActionType = 'move' | 'markRead' | 'markUnread' | 'star' | 'unstar' | 'label' | 'unlabel' | 'forward' | 'delete' | 'priority' | 'toTodo'
export interface RuleAction { type: ActionType; targetFolder?: string; labelIds?: number[]; forwardTo?: string; priority?: 'high' | 'normal' | 'low'; markRead?: boolean }
export type RuleKind = 'normal' | 'whitelist' | 'blacklist'

export interface RuleMessageContext { messageId: number; accountId: number; from: string; to: string; cc: string; subject: string; body: string; hasAttachment: boolean; sizeKb: number; labelIds: number[] }

export interface Rule { id: number; accountId: number; name: string; enabled: boolean; kind: RuleKind; conditions: ConditionGroup; actions: RuleAction[]; order: number }
export interface RuleTestHit { messageId: number; ruleId: number; ruleName: string; matched: boolean; actions: RuleAction[] }
