# 子项目 10 — 规则与过滤器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 webmail 加上邮件规则/过滤器系统——按发件人/主题/正文/附件/大小/标签组合匹配新收邮件，自动执行移动/标记已读/标星/贴标签/转发/删除/优先级，配白/黑名单、Inbox Sweep（一键归档某发件人旧邮件）、可视化规则编辑器与对历史邮件的试跑预览。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 10）。本地单机、单进程、单 SQLite(WAL)。`rules` 表按 `account_id` 隔离、`order` 决定匹配优先级、`conditions`/`actions` 以 JSON 存。**规则引擎是纯函数**：`matchConditions(ctx, conditions): boolean` 与 `applyActions(...)` 可脱离 DB/IMAP 单测；引擎挂在同步流水线的「规则匹配」stage（spec §0：拉取→解析→**规则匹配**→入库→LLM 抽取拆成独立 stage）——对新收邮件按 `order` 升序遍历 enabled 规则，**first-match-wins**（一条邮件命中首条规则即执行其 actions 并停止，避免一条邮件被多条规则反复移动）。本地动作（markRead/star/label/priority/转待办）即时改库；IMAP 动作（move/delete）经子项目 3 的 `applyAction(db,{adapter,action,...})` 走 `MailAdapter.move/delete` 用 UID 回写服务器；`forward` 经 `MailAdapter.send`。白名单 = 命中即跳过所有规则（防误判），黑名单 = 命中即 trash/delete 且不进规则流程。Inbox Sweep 是一次性批量操作（非规则），对某发件人的历史邮件除最新一封外全部归档。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 1（drizzle 迁移框架 + messages `account_id/folder/imap_uid/is_archived` 列）、子项目 2（`accounts` 表 + `getAdapter(accountId): MailAdapter` + `MailAdapter.send`）、子项目 3（`applyAction` 的 `move/delete/markRead/star/archive` UID 回写 + `folders` 表）、子项目 8（`labels`/`message_labels` + `attachLabels`）。规则引擎挂子项目 6 同步队列/`incrementalSync` 的 stage——若子项目 6 流水线已把「入库后」抽成 hook 则直接接入，否则在 `src/lib/scheduler/index.ts` 与 `src/app/api/fetch/route.ts` 的 `db.insert(messages)` 成功分支后调 `runRulesForMessage`。阶段 3 执行——每任务先写失败测试再实现（TDD 先红后绿）。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — `rules` 表（Task 1）
- Create: `src/lib/rules/types.ts` — conditions/actions 的 TS 类型 + JSON schema 常量（Task 2）
- Create: `src/lib/rules/match.ts` — `matchConditions` 纯函数（Task 3）
- Create: `src/lib/rules/actions.ts` — `applyActions` 纯函数 + `runRulesForMessage` 流水线入口（Task 4）
- Create: `src/lib/rules/repo.ts` — rules 读写 + 排序 + 启停（Task 5）
- Create: `src/lib/rules/list.ts` — 白/黑名单（基于特殊规则，Task 6）
- Create: `src/lib/rules/sweep.ts` — Inbox Sweep 批量归档（Task 7）
- Modify: `src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts` — 入库后接 `runRulesForMessage`（Task 4 Step 6）
- Create: `src/app/api/rules/route.ts` — GET 列表 / POST 创建（Task 8）
- Create: `src/app/api/rules/[id]/route.ts` — PATCH 改 / DELETE 删 / PUT 排序（Task 8）
- Create: `src/app/api/rules/[id]/test/route.ts` — POST 试跑对历史邮件预览（Task 9）
- Create: `src/app/api/rules/sweep/route.ts` — POST Inbox Sweep（Task 10）
- Create: `src/app/rules/page.tsx` — 规则列表 + 编辑器 + 试跑 UI（Task 11）
- Modify: `src/components/nav/Sidebar.tsx` — 「规则」入口 + 当前账号切换（Task 12）
- Test: `src/__tests__/rules/match.test.ts`、`src/__tests__/rules/actions.test.ts`、`src/__tests__/rules/repo.test.ts`、`src/__tests__/rules/list.test.ts`、`src/__tests__/rules/sweep.test.ts`、`src/__tests__/api/rules.test.ts`、`src/__tests__/api/rules-test.test.ts`、`src/__tests__/api/rules-sweep.test.ts`、`src/__tests__/db/migration.test.ts`（补 rules 行）

---

## 任务

### Task 1: rules 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: `src/__tests__/db/migration.test.ts`

- [ ] **Step 1: 在 schema.ts 加 rules 表**

```ts
/** 邮件规则/过滤器（按账号隔离，order 决定匹配优先级，小在前） */
export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // 条件组合 JSON,见 src/lib/rules/types.ts 的 RuleCondition[]
  conditions: text('conditions').notNull(),   // JSON string
  // 动作列表 JSON,见 RuleAction[]
  actions: text('actions').notNull(),          // JSON string
  order: integer('order').notNull().default(0),
  // 规则种类:normal(普通) | whitelist(白名单) | blacklist(黑名单)
  // whitelist/blacklist 在 runRulesForMessage 里短路处理,不参与普通 first-match-wins
  kind: text('kind', { enum: ['normal', 'whitelist', 'blacklist'] }).notNull().default('normal'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  accOrderIdx: index('idx_rules_account_order').on(t.accountId, t.order),
  accKindIdx: index('idx_rules_account_kind').on(t.accountId, t.kind),
}))
```

- [ ] **Step 2: 生成迁移** `npm run db:generate`（产出 rules 建表 SQL + 两索引）。

- [ ] **Step 3: 在 `src/__tests__/db/migration.test.ts` 补一行断言**：迁移后 `SELECT name FROM sqlite_master WHERE type='table' AND name='rules'` 非空。`npx vitest run src/__tests__/db/migration.test.ts` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ src/__tests__/db/migration.test.ts
git commit -m "feat(db): rules table for mail filters (conditions/actions JSON + order)"
git push
```

---

### Task 2: conditions / actions 类型 + JSON schema

**Files:**
- Create: `src/lib/rules/types.ts`

- [ ] **Step 1: 写类型定义（无独立测试文件,本任务的产物被 Task 3/4 的测试覆盖）**

```ts
// src/lib/rules/types.ts

/** 单个匹配条件 */
export type RuleOperator =
  | 'contains'      // 包含(子串,大小写不敏感)
  | 'notContains'
  | 'equals'        // 精确等于(大小写不敏感)
  | 'startsWith'
  | 'endsWith'
  | 'matchesRegex'  // 正则
  | 'gt'            // 数值大于(size 用,单位 KB)
  | 'lt'

/** 条件字段:发件人/主题/正文/有附件/大小/标签 */
export type ConditionField =
  | 'from'
  | 'subject'
  | 'body'
  | 'hasAttachment'
  | 'size'        // KB
  | 'label'       // 联动 plan-08 标签,labelId
  | 'to'
  | 'cc'

export interface RuleCondition {
  field: ConditionField
  operator: RuleOperator
  value: string | number | boolean
}

/** 条件之间的逻辑组合 */
export type ConditionCombinator = 'and' | 'or'

/** 规则的完整条件集:多个条件按 combinator 组合 */
export interface ConditionGroup {
  combinator: ConditionCombinator
  conditions: RuleCondition[]
}

/** 动作类型 */
export type ActionType =
  | 'move'         // 移动文件夹(targetFolder),经 adapter.move 回写
  | 'markRead'
  | 'markUnread'
  | 'star'
  | 'unstar'
  | 'label'        // 贴标签(labelIds),本地
  | 'unlabel'
  | 'forward'      // 转发到 forwardTo 地址,经 adapter.send
  | 'delete'       // 删除(经 adapter.delete / Trash)
  | 'priority'     // 设置优先级(priority: high|normal|low),本地
  | 'toTodo'       // 转待办,本地(复用 plan-08 message->todo)

export interface RuleAction {
  type: ActionType
  // 按 type 取相应字段:
  targetFolder?: string   // move
  labelIds?: number[]     // label/unlabel
  forwardTo?: string      // forward(逗号分隔多地址)
  priority?: 'high' | 'normal' | 'low'  // priority
  markRead?: boolean      // markRead value(true/false),markUnread 忽略
}

/** 规则种类 */
export type RuleKind = 'normal' | 'whitelist' | 'blacklist'

/** 匹配时喂给引擎的邮件上下文(从 messages 行 + 附件元数据组装) */
export interface RuleMessageContext {
  messageId: number              // messages.id
  accountId: number
  from: string                   // messages.sender
  to: string                     // messages.recipient
  cc: string
  subject: string
  body: string                   // 纯文本正文(子项目 1 修截断后为全文)
  hasAttachment: boolean
  sizeKb: number                 // 邮件总大小(KB,含附件;无则 0)
  labelIds: number[]             // 该邮件已贴的标签 id(联动 plan-08)
}

/** rules 表行在内存中的形态(JSON 已解析) */
export interface Rule {
  id: number
  accountId: number
  name: string
  enabled: boolean
  kind: RuleKind
  conditions: ConditionGroup
  actions: RuleAction[]
  order: number
}

/** 试跑结果:某邮件命中的规则 + 将执行的动作 */
export interface RuleTestHit {
  messageId: number
  ruleId: number
  ruleName: string
  matched: boolean
  actions: RuleAction[]
}
```

- [ ] **Step 2: `npx tsc --noEmit`** 确认类型无错（此时无引用方，应通过）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/rules/types.ts
git commit -m "feat(rules): condition/action TypeScript types + JSON schema"
git push
```

---

### Task 3: matchConditions 纯函数

**Files:**
- Create: `src/lib/rules/match.ts`
- Test: `src/__tests__/rules/match.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { matchConditions } from '@/lib/rules/match'
import type { RuleMessageContext, ConditionGroup } from '@/lib/rules/types'

const ctx = (over: Partial<RuleMessageContext> = {}): RuleMessageContext => ({
  messageId: 1, accountId: 1, from: 'Alice <alice@example.com>',
  to: 'me@x.com', cc: '', subject: '周报 Q2',
  body: '本周完成 A 和 B', hasAttachment: true, sizeKb: 200,
  labelIds: [], ...over,
})

describe('matchConditions', () => {
  it('from contains 命中(大小写不敏感)', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: 'alice@' }] }
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('subject equals 命中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'subject', operator: 'equals', value: '周报 q2' }] }
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('body contains notContains 不命中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'body', operator: 'contains', value: '不存在的内容' }] }
    expect(matchConditions(ctx(), g)).toBe(false)
  })
  it('hasAttachment equals true 命中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'hasAttachment', operator: 'equals', value: true }] }
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('size gt(数值,KB) 命中/不命中', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'size', operator: 'gt', value: 100 }] })).toBe(true)
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [{ field: 'size', operator: 'gt', value: 500 }] })).toBe(false)
  })
  it('label equals(labelId) 命中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'label', operator: 'equals', value: 5 }] }
    expect(matchConditions(ctx({ labelIds: [5, 9] }), g)).toBe(true)
    expect(matchConditions(ctx({ labelIds: [9] }), g)).toBe(false)
  })
  it('正则 matchesRegex 命中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'subject', operator: 'matchesRegex', value: '^周报' }] }
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('非法正则当不命中(不抛异常)', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [{ field: 'subject', operator: 'matchesRegex', value: '(' }] }
    expect(matchConditions(ctx(), g)).toBe(false)
  })
  it('AND 组合:全中才中', () => {
    const g: ConditionGroup = { combinator: 'and', conditions: [
      { field: 'from', operator: 'contains', value: 'alice' },
      { field: 'hasAttachment', operator: 'equals', value: true },
    ]}
    expect(matchConditions(ctx(), g)).toBe(true)
    expect(matchConditions(ctx({ hasAttachment: false }), g)).toBe(false)
  })
  it('OR 组合:任一中即中', () => {
    const g: ConditionGroup = { combinator: 'or', conditions: [
      { field: 'subject', operator: 'contains', value: '不存在' },
      { field: 'hasAttachment', operator: 'equals', value: true },
    ]}
    expect(matchConditions(ctx(), g)).toBe(true)
  })
  it('空 conditions 数组 → 命中(视为通配)', () => {
    expect(matchConditions(ctx(), { combinator: 'and', conditions: [] })).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/rules/match.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/lib/rules/match.ts
import type { ConditionGroup, RuleCondition, RuleMessageContext, RuleOperator } from './types'

function asString(v: unknown): string {
  if (v == null) return ''
  return String(v).toLowerCase()
}

function applyStringOp(haystack: string, op: RuleOperator, needle: string): boolean {
  switch (op) {
    case 'contains': return haystack.includes(needle)
    case 'notContains': return !haystack.includes(needle)
    case 'equals': return haystack === needle
    case 'startsWith': return haystack.startsWith(needle)
    case 'endsWith': return haystack.endsWith(needle)
    case 'matchesRegex': {
      try { return new RegExp(needle).test(haystack) } catch { return false }
    }
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
      const size = ctx.sizeKb
      if (c.operator === 'gt') return size > threshold
      if (c.operator === 'lt') return size < threshold
      // size 也允许 contains/equals 等退化(不实用)按字符串比
      return applyStringOp(String(size), c.operator, String(threshold))
    }
    case 'label': {
      const labelId = Number(v)
      const hit = ctx.labelIds.includes(labelId)
      return c.operator === 'notContains' ? !hit : hit
    }
    default: return false
  }
}

/** 评估条件组是否匹配邮件上下文。纯函数,无副作用,可单测。 */
export function matchConditions(ctx: RuleMessageContext, group: ConditionGroup): boolean {
  if (!group.conditions || group.conditions.length === 0) return true // 通配
  const results = group.conditions.map((c) => evalCondition(ctx, c))
  return group.combinator === 'or'
    ? results.some(Boolean)
    : results.every(Boolean)
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/match.ts src/__tests__/rules/match.test.ts
git commit -m "feat(rules): pure matchConditions over field/operator/combinator"
git push
```

---

### Task 4: applyActions + runRulesForMessage（规则引擎流水线入口）

**Files:**
- Create: `src/lib/rules/actions.ts`
- Modify: `src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts`（接线）
- Test: `src/__tests__/rules/actions.test.ts`

**关键设计：**
- `runRulesForMessage(db, { context, getAdapter })` 是流水线入口：
  1. 取该账号全部 enabled 规则，按 `kind` 分三组：`whitelist` / `blacklist` / `normal`。
  2. **白名单短路**：任一 whitelist 规则 `matchConditions` 命中 → 直接返回（跳过所有 normal/blacklist，防误判）。
  3. **黑名单短路**：任一 blacklist 规则命中 → 执行 `delete`（经 `applyAction` 移 Trash/删除）→ 返回。
  4. **normal first-match-wins**：按 `order` 升序遍历，首条命中即执行其 actions 并停止（避免一封邮件被多规则反复移动）。
- `applyActions` 按 action 类型分流：`move`/`delete`/`markRead`/`markUnread`/`star`/`unstar` 经子项目 3 的 `applyAction(db,{adapter,action,...})`（UID 回写）；`label`/`unlabel` 经子项目 8 的 `attachLabels`/`detachLabel`（纯本地）；`priority` 改 messages 本地列（子项目 1 需有 `priority` 列，若 schema 未定义则本任务降级为写 `labels` 里的 `Priority:High` 标签——见风险）；`toTodo` 经 plan-08 的 message→todo；`forward` 经 `adapter.send`。
- `applyActions` 返回已执行动作清单（供试跑预览与日志）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { applyActions, runRulesForMessage } from '@/lib/rules/actions'
import type { RuleMessageContext, RuleAction, Rule } from '@/lib/rules/types'
import { memDb } from '../helpers/memDb' // 同 plan-08 的内存 DB helper(建全列表)

const baseCtx = (over: Partial<RuleMessageContext> = {}): RuleMessageContext => ({
  messageId: 1, accountId: 1, from: 'a@x.com', to: 'me@x.com', cc: '',
  subject: 's', body: 'b', hasAttachment: false, sizeKb: 10, labelIds: [], ...over,
})

describe('applyActions', () => {
  it('markRead → applyAction markRead value=true', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid, is_read) VALUES (1,'<m>',1,'s','INBOX',10,0)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'markRead' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'markRead', messageIds: [1], value: true }))
  })
  it('move → applyAction move targetFolder', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'move', targetFolder: 'Archive' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'move', messageIds: [1], targetFolder: 'Archive' }))
  })
  it('delete → applyAction delete', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'delete' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delete', messageIds: [1] }))
  })
  it('label → 本地 attachLabels(不调 applyAction)', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s'); INSERT INTO labels (id, account_id, name, color) VALUES (5,1,'A','#fff')`)
    const applyAction = vi.fn()
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'label', labelIds: [5] }], applyAction })
    expect(applyAction).not.toHaveBeenCalled()
    expect((db.prepare(`SELECT count(*) c FROM message_labels WHERE message_id=1 AND label_id=5`).get() as any).c).toBe(1)
  })
  it('forward → adapter.send 转发', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, body) VALUES (1,'<m>',1,'Hi','正文')`)
    const send = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'forward', forwardTo: 'boss@x.com' }], applyAction: vi.fn(), send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'boss@x.com', subject: 'Fwd: Hi' }))
  })
  it('返回已执行动作清单', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applied = await applyActions(db, { context: baseCtx(), actions: [{ type: 'markRead' }, { type: 'star' }], applyAction: vi.fn() })
    expect(applied.map((a) => a.type)).toEqual(['markRead', 'star'])
  })
})

describe('runRulesForMessage', () => {
  const rules = (over: Partial<Rule>[]): Rule[] => over.map((r, i) => ({
    id: i + 1, accountId: 1, name: `r${i}`, enabled: true, kind: 'normal', order: i,
    conditions: { combinator: 'and', conditions: [] }, actions: [], ...r,
  } as Rule))

  it('白名单命中 → 跳过所有 normal(不执行)', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES
      (1,1,'wl',1,'{"combinator":"and","conditions":[{"field":"from","operator":"contains","value":"a@"}]}','[]',0,'whitelist'),
      (2,1,'mv',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"Archive"}]',1,'normal')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({} as any), applyAction })
    expect(applyAction).not.toHaveBeenCalled() // 白名单挡住,normal 没跑
    expect(res.matchedRuleId).toBeNull()
  })
  it('黑名单命中 → 执行 delete', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, from, folder, imap_uid) VALUES (1,'<m>',1,'s','spam@x.com','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES
      (1,1,'bl',1,'{"combinator":"and","conditions":[{"field":"from","operator":"contains","value":"spam@"}]}','[{"type":"delete"}]',0,'blacklist')`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await runRulesForMessage(db, { context: baseCtx({ from: 'spam@x.com' }), getAdapter: () => ({} as any), applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delete' }))
    expect(res.matchedRuleId).toBe(1)
  })
  it('normal first-match-wins:只执行第一条命中的规则', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES
      (1,1,'r1',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"A"}]',0,'normal'),
      (2,1,'r2',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"B"}]',1,'normal')`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({} as any), applyAction })
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetFolder: 'A' }))
    expect(res.matchedRuleId).toBe(1)
  })
  it('禁用的规则不参与', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES
      (1,1,'off',0,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"A"}]',0,'normal')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({} as any), applyAction })
    expect(applyAction).not.toHaveBeenCalled()
    expect(res.matchedRuleId).toBeNull()
  })
  it('无规则 → 不抛、不执行', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({} as any), applyAction })
    expect(res.matchedRuleId).toBeNull()
    expect(applyAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `applyActions`**

```ts
// src/lib/rules/actions.ts
import type { Database } from '@/lib/db' // better-sqlite3 Database 别名(随项目)
import type { RuleAction, RuleMessageContext, Rule, ConditionGroup, RuleKind } from './types'
import { matchConditions } from './match'
import { attachLabels, detachLabel } from '@/lib/labels/repo' // plan-08

export interface ApplyActionsDeps {
  applyAction: (db: any, opts: any) => Promise<void> // 子项目 3 writeback.applyAction
  send?: (msg: { to: string; subject: string; body: string; bodyHtml?: string }) => Promise<void> // adapter.send(for forward)
}

export async function applyActions(
  db: any,
  args: { context: RuleMessageContext; actions: RuleAction[]; applyAction: ApplyActionsDeps['applyAction']; send?: ApplyActionsDeps['send'] },
): Promise<RuleAction[]> {
  const { context, actions } = args
  const applied: RuleAction[] = []
  for (const a of actions) {
    switch (a.type) {
      case 'move':
      case 'delete':
        await args.applyAction(db, { adapter: undefined, action: a.type, messageIds: [context.messageId], targetFolder: a.targetFolder })
        break
      case 'markRead':
        await args.applyAction(db, { adapter: undefined, action: 'markRead', messageIds: [context.messageId], value: true })
        break
      case 'markUnread':
        await args.applyAction(db, { adapter: undefined, action: 'markRead', messageIds: [context.messageId], value: false })
        break
      case 'star':
      case 'unstar':
        await args.applyAction(db, { adapter: undefined, action: 'star', messageIds: [context.messageId], value: a.type === 'star' })
        break
      case 'label':
        if (a.labelIds?.length) attachLabels(db, { messageIds: [context.messageId], labelIds: a.labelIds })
        break
      case 'unlabel':
        if (a.labelIds?.length) for (const lid of a.labelIds) detachLabel(db, { messageId: context.messageId, labelId: lid })
        break
      case 'priority':
        // 本地:写 messages.priority 列;若列不存在则降级贴 Priority 标签(见风险)
        db.prepare(`UPDATE messages SET priority = ? WHERE id = ?`).run(a.priority ?? 'normal', context.messageId)
        break
      case 'toTodo': {
        // 复用 plan-08 message->todo:取邮件 + 建 todo + todo_count+1
        const m = db.prepare(`SELECT message_id, subject, sender FROM messages WHERE id = ?`).get(context.messageId) as any
        if (m) {
          db.prepare(`INSERT INTO todos (title, source_message_id, source_subject, source_from) VALUES (?,?,?,?)`)
            .run(m.subject ?? '(无主题)', m.message_id, m.subject, m.sender)
          db.prepare(`UPDATE messages SET todo_count = todo_count + 1 WHERE id = ?`).run(context.messageId)
        }
        break
      }
      case 'forward':
        if (a.forwardTo && args.send) {
          const m = db.prepare(`SELECT subject, body, body_html FROM messages WHERE id = ?`).get(context.messageId) as any
          await args.send({ to: a.forwardTo, subject: `Fwd: ${m?.subject ?? ''}`, body: m?.body ?? '', bodyHtml: m?.body_html })
        }
        break
    }
    applied.push(a)
  }
  return applied
}
```

> 注：`applyAction` 的 adapter 在 `runRulesForMessage` 里用 `getAdapter(accountId)` 真实注入；上面 `applyActions` 签名把 adapter 留给调用方在 opts 里带（`applyAction` 内部已封装 adapter 调用），故此处传 `adapter: undefined` 占位由真实 `applyAction` 闭包覆盖——实际接线时 `runRulesForMessage` 传入的 `applyAction` 是已绑定 adapter 的版本（见 Step 4）。

- [ ] **Step 4: 实现 `runRulesForMessage`**

```ts
// 接 src/lib/rules/actions.ts

export interface RunRulesDeps {
  getAdapter: (accountId: number) => any            // plan-02 getAdapter
  applyAction?: (db: any, opts: any) => Promise<void> // 默认用子项目3真实 applyAction
}

export interface RuleRunResult {
  matchedRuleId: number | null
  matchedRuleName: string | null
  appliedActions: RuleAction[]
  shortCircuit: 'whitelist' | 'blacklist' | null
}

interface RuleRow { id: number; account_id: number; name: string; enabled: number; conditions: string; actions: string; order: number; kind: RuleKind }

function parseRule(r: RuleRow): Rule {
  return {
    id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind,
    conditions: JSON.parse(r.conditions) as ConditionGroup,
    actions: JSON.parse(r.actions) as RuleAction[],
    order: r.order,
  }
}

export async function runRulesForMessage(
  db: any,
  args: { context: RuleMessageContext; getAdapter: RunRulesDeps['getAdapter']; applyAction: (db: any, opts: any) => Promise<void>; send?: (m: any) => Promise<void> },
): Promise<RuleRunResult> {
  const { context } = args
  const rows = db.prepare(`SELECT * FROM rules WHERE account_id = ? AND enabled = 1 ORDER BY "order" ASC, id ASC`).all(context.accountId) as RuleRow[]
  const rules = rows.map(parseRule)
  const whitelist = rules.filter((r) => r.kind === 'whitelist')
  const blacklist = rules.filter((r) => r.kind === 'blacklist')
  const normal = rules.filter((r) => r.kind === 'normal')

  // 1. 白名单短路
  for (const r of whitelist) {
    if (matchConditions(context, r.conditions)) {
      return { matchedRuleId: null, matchedRuleName: null, appliedActions: [], shortCircuit: 'whitelist' }
    }
  }
  // 2. 黑名单短路 → delete
  for (const r of blacklist) {
    if (matchConditions(context, r.conditions)) {
      await applyActions(db, { context, actions: r.actions.length ? r.actions : [{ type: 'delete' }], applyAction: args.applyAction, send: args.send })
      return { matchedRuleId: r.id, matchedRuleName: r.name, appliedActions: r.actions, shortCircuit: 'blacklist' }
    }
  }
  // 3. normal first-match-wins
  for (const r of normal) {
    if (matchConditions(context, r.conditions)) {
      const applied = await applyActions(db, { context, actions: r.actions, applyAction: args.applyAction, send: args.send })
      return { matchedRuleId: r.id, matchedRuleName: r.name, appliedActions: applied, shortCircuit: null }
    }
  }
  return { matchedRuleId: null, matchedRuleName: null, appliedActions: [], shortCircuit: null }
}
```

- [ ] **Step 5: 运行确认通过** → PASS。

> **测试里的 `applyAction` 注入**：生产路径用子项目 3 真实的 `applyAction`（已封装 `getAdapter` 调用 + UID 回写 + 乐观更新/回滚）。测试里传 mock 即可。`runRulesForMessage` 不直接拿 adapter——它把动作全权委托给注入的 `applyAction`，后者内部按 accountId 取 adapter。这样规则引擎对 IMAP 零依赖、纯可测。

- [ ] **Step 6: 在同步流水线接线**：`src/lib/scheduler/index.ts` 与 `src/app/api/fetch/route.ts` 的 `db.insert(messages)` 成功分支（即「非 existing」的新邮件入库）之后，组装 `RuleMessageContext` 并调 `runRulesForMessage`：

```ts
// 伪代码,插在新邮件 insert 成功后:
import { runRulesForMessage } from '@/lib/rules/actions'
import { getAdapter } from '@/lib/adapter' // plan-02
import { applyAction } from '@/lib/sync/writeback' // plan-03
import { getDb } from '@/lib/db'

// 组装 context(从入库返回的 messageId + RawMessage 字段):
const labelIds = (getDb().prepare(`SELECT label_id FROM message_labels WHERE message_id = ?`).all(insertedId).map((r:any)=>r.label_id))
const sizeKb = msg.size ? Math.round(msg.size / 1024) : 0
const hasAttachment = !!(msg.attachments && msg.attachments.length)
await runRulesForMessage(getDb(), {
  context: { messageId: insertedId, accountId: msg.accountId, from: msg.from, to: msg.to ?? '', cc: msg.cc ?? '', subject: msg.subject ?? '', body: msg.body ?? '', hasAttachment, sizeKb, labelIds },
  getAdapter,
  applyAction, // 真实 writeback.applyAction(db,{adapter: getAdapter(accountId),...})
  send: (m) => getAdapter(msg.accountId).send(m),
})
```

> 接线时 `applyAction` 须用真实版（内部 `adapter = getAdapter(accountId)`）。若 plan-06 已把流水线拆成 stage 函数（如 `stageRuleMatch(db, msg)`），则把上述逻辑放进该 stage 而非内联 scheduler。**此步无新单元测试**（核心逻辑已由 Task 4 覆盖），仅接线 + 手测：建一条 `from contains alice → move Archive` 规则，收一封 alice 的邮件验证自动归档并同步服务器。

- [ ] **Step 7: Commit**

```bash
git add src/lib/rules/actions.ts src/__tests__/rules/actions.test.ts src/lib/scheduler/index.ts src/app/api/fetch/route.ts
git commit -m "feat(rules): rule engine (applyActions + runRulesForMessage) wired into ingest pipeline"
git push
```

---

### Task 5: rules repo（CRUD + 排序 + 启停）

**Files:**
- Create: `src/lib/rules/repo.ts`
- Test: `src/__tests__/rules/repo.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { createRule, listRules, updateRule, deleteRule, setEnabled, reorderRules, getRule } from '@/lib/rules/repo'
import { memDb } from '../helpers/memDb'

describe('rules repo', () => {
  it('createRule 写入 + listRules 按 order 升序', () => {
    const db = memDb()
    createRule(db, { accountId: 1, name: 'R2', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 2, kind: 'normal' })
    createRule(db, { accountId: 1, name: 'R1', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1, kind: 'normal' })
    const ls = listRules(db, 1)
    expect(ls.map((r) => r.name)).toEqual(['R1', 'R2'])
  })
  it('getRule 解析 JSON conditions/actions', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'or', conditions: [{ field: 'from', operator: 'contains', value: 'x' }] }, actions: [{ type: 'star' }], order: 0, kind: 'normal' })
    const r = getRule(db, id)
    expect(r.conditions.combinator).toBe('or')
    expect(r.actions[0].type).toBe('star')
  })
  it('updateRule 改 name/conditions/actions', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    updateRule(db, id, { name: 'R2', actions: [{ type: 'markRead' }] })
    expect(getRule(db, id).name).toBe('R2')
    expect(getRule(db, id).actions[0].type).toBe('markRead')
  })
  it('setEnabled 切换 enabled', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    setEnabled(db, id, false)
    expect(getRule(db, id).enabled).toBe(false)
  })
  it('deleteRule 删除', () => {
    const db = memDb()
    const id = createRule(db, { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    deleteRule(db, id)
    expect(getRule(db, id)).toBeNull()
  })
  it('reorderRules 批量改 order(事务)', () => {
    const db = memDb()
    const a = createRule(db, { accountId: 1, name: 'A', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0, kind: 'normal' })
    const b = createRule(db, { accountId: 1, name: 'B', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1, kind: 'normal' })
    reorderRules(db, [{ id: a, order: 1 }, { id: b, order: 0 }])
    expect(getRule(db, a).order).toBe(1)
    expect(getRule(db, b).order).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/rules/repo.ts
import type { Rule, ConditionGroup, RuleAction, RuleKind } from './types'

export function createRule(db: any, input: { accountId: number; name: string; conditions: ConditionGroup; actions: RuleAction[]; order: number; kind?: RuleKind; enabled?: boolean }): number {
  const res = db.prepare(`INSERT INTO rules (account_id, name, enabled, conditions, actions, "order", kind) VALUES (?,?,?,?,?,?,?)`).run(
    input.accountId, input.name, input.enabled === false ? 0 : 1,
    JSON.stringify(input.conditions), JSON.stringify(input.actions), input.order, input.kind ?? 'normal',
  )
  return Number(res.lastInsertRowid)
}

export function getRule(db: any, id: number): Rule | null {
  const r = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as any
  if (!r) return null
  return { id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions), order: r.order }
}

export function listRules(db: any, accountId: number): Rule[] {
  const rows = db.prepare(`SELECT * FROM rules WHERE account_id = ? ORDER BY "order" ASC, id ASC`).all(accountId) as any[]
  return rows.map((r) => ({ id: r.id, accountId: r.account_id, name: r.name, enabled: !!r.enabled, kind: r.kind, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions), order: r.order }))
}

export function updateRule(db: any, id: number, patch: Partial<Pick<Rule, 'name' | 'conditions' | 'actions' | 'kind'>>): void {
  const cur = getRule(db, id)
  if (!cur) return
  db.prepare(`UPDATE rules SET name = ?, conditions = ?, actions = ?, kind = ? WHERE id = ?`).run(
    patch.name ?? cur.name,
    JSON.stringify(patch.conditions ?? cur.conditions),
    JSON.stringify(patch.actions ?? cur.actions),
    patch.kind ?? cur.kind,
    id,
  )
}

export function setEnabled(db: any, id: number, enabled: boolean): void {
  db.prepare(`UPDATE rules SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
}

export function deleteRule(db: any, id: number): void {
  db.prepare(`DELETE FROM rules WHERE id = ?`).run(id)
}

export function reorderRules(db: any, entries: { id: number; order: number }[]): void {
  const tx = db.transaction(() => {
    for (const e of entries) db.prepare(`UPDATE rules SET "order" = ? WHERE id = ?`).run(e.order, e.id)
  })
  tx()
}

/** 下一个可用 order(新建规则默认追加到末尾) */
export function nextOrder(db: any, accountId: number): number {
  const r = db.prepare(`SELECT COALESCE(MAX("order"), -1) + 1 AS o FROM rules WHERE account_id = ?`).get(accountId) as any
  return r.o
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/repo.ts src/__tests__/rules/repo.test.ts
git commit -m "feat(rules): rule repo (create/list/update/delete/toggle/reorder)"
git push
```

---

### Task 6: 白名单 / 黑名单

**Files:**
- Create: `src/lib/rules/list.ts`
- Test: `src/__tests__/rules/list.test.ts`

**关键设计：** 白/黑名单是 `kind='whitelist'|'blacklist'` 的特殊规则，共享 `rules` 表与引擎（Task 4 已处理短路逻辑）。本任务只提供便捷构造函数 + 查询助手，让 UI「一键加白/黑名单」不必手搓 conditions JSON。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { addToList, listWhitelist, listBlacklist, removeFromList, isWhitelisted } from '@/lib/rules/list'
import { memDb } from '../helpers/memDb'

describe('whitelist/blacklist helpers', () => {
  it('addToList whitelist 建一条 from contains 规则', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'boss@x.com' })
    const wl = listWhitelist(db, 1)
    expect(wl).toHaveLength(1)
    expect(wl[0].conditions.conditions[0]).toMatchObject({ field: 'from', operator: 'contains', value: 'boss@x.com' })
    expect(wl[0].kind).toBe('whitelist')
  })
  it('addToList blacklist → listBlacklist', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'blacklist', email: 'spam@x.com' })
    expect(listBlacklist(db, 1)).toHaveLength(1)
  })
  it('removeFromList 按 id 删', () => {
    const db = memDb()
    const id = addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    removeFromList(db, id)
    expect(listWhitelist(db, 1)).toHaveLength(0)
  })
  it('isWhitelisted:from 命中任一白名单 → true', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'vip@x.com' })
    expect(isWhitelisted(db, { accountId: 1, from: 'VIP <vip@x.com>' })).toBe(true)
    expect(isWhitelisted(db, { accountId: 1, from: 'other@x.com' })).toBe(false)
  })
  it('同 email 重复 add 不产生重复规则', () => {
    const db = memDb()
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    addToList(db, { accountId: 1, kind: 'whitelist', email: 'a@x.com' })
    expect(listWhitelist(db, 1)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/rules/list.ts
import type { Rule, RuleKind } from './types'
import { createRule, listRules, deleteRule, nextOrder } from './repo'
import { matchConditions } from './match'

function fromContains(email: string) {
  return { combinator: 'and' as const, conditions: [{ field: 'from' as const, operator: 'contains' as const, value: email.toLowerCase() }] }
}

export function addToList(db: any, input: { accountId: number; kind: 'whitelist' | 'blacklist'; email: string }): number {
  const email = input.email.toLowerCase().trim()
  // 去重:同 account + kind + 已有相同 from-contains 值则跳过
  const existing = listRules(db, input.accountId).filter((r) => r.kind === input.kind)
  const dup = existing.find((r) => r.conditions.conditions.some((c) => c.field === 'from' && String(c.value).toLowerCase() === email))
  if (dup) return dup.id
  return createRule(db, {
    accountId: input.accountId,
    name: `${input.kind === 'whitelist' ? '白名单' : '黑名单'}: ${email}`,
    conditions: fromContains(email),
    actions: input.kind === 'blacklist' ? [{ type: 'delete' }] : [],
    order: nextOrder(db, input.accountId),
    kind: input.kind as RuleKind,
  })
}

export function listWhitelist(db: any, accountId: number): Rule[] {
  return listRules(db, accountId).filter((r) => r.kind === 'whitelist')
}
export function listBlacklist(db: any, accountId: number): Rule[] {
  return listRules(db, accountId).filter((r) => r.kind === 'blacklist')
}
export function removeFromList(db: any, id: number): void {
  deleteRule(db, id)
}
export function isWhitelisted(db: any, input: { accountId: number; from: string }): boolean {
  return listWhitelist(db, input.accountId).some((r) => matchConditions({ messageId: 0, accountId: input.accountId, from: input.from, to: '', cc: '', subject: '', body: '', hasAttachment: false, sizeKb: 0, labelIds: [] }, r.conditions))
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/list.ts src/__tests__/rules/list.test.ts
git commit -m "feat(rules): whitelist/blacklist helpers on top of rules table"
git push
```

---

### Task 7: Inbox Sweep（一键归档某发件人旧邮件）

**Files:**
- Create: `src/lib/rules/sweep.ts`
- Test: `src/__tests__/rules/sweep.test.ts`

**关键设计：** Sweep 是一次性批量操作（不是规则）。对指定 `account_id` + `fromEmail`，取该发件人全部 INBOX/收件邮件（`folder IN inbox AND is_archived=0 AND is_deleted=0`），按 `received_at DESC` 排序，**保留最新一封**，其余全部 `archive`（经 `applyAction` 回写 + 本地 `is_archived=1`）。返回归档数量与归档的 messageId 列表。可配 `keep: N`（默认 1）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { inboxSweep } from '@/lib/rules/sweep'
import { memDb } from '../helpers/memDb'

describe('inboxSweep', () => {
  it('保留最新一封,其余归档', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES
      (1,'<a>',1,'news@x.com','INBOX',0,0,1000),
      (2,'<b>',1,'news@x.com','INBOX',0,0,2000),
      (3,'<c>',1,'news@x.com','INBOX',0,0,3000),
      (4,'<d>',1,'other@x.com','INBOX',0,0,4000)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'news@x.com', applyAction })
    expect(res.keptMessageId).toBe(3)         // 最新(received_at=3000)
    expect(res.archivedIds).toEqual([1, 2])   // 旧的 1,2 归档
    expect(res.archivedCount).toBe(2)
    // 不动 other 发件人
    expect((db.prepare(`SELECT is_archived FROM messages WHERE id=4`).get() as any).is_archived).toBe(0)
  })
  it('keep=2 保留最新两封', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES
      (1,'<a>',1,'n@x.com','INBOX',0,0,100),(2,'<b>',1,'n@x.com','INBOX',0,0,200),(3,'<c>',1,'n@x.com','INBOX',0,0,300)`)
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'n@x.com', keep: 2, applyAction: vi.fn().mockResolvedValue(undefined) })
    expect(res.keptMessageId).toBe(3)
    expect(res.archivedIds).toEqual([1])
  })
  it('只有一封 → 不归档', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES (1,'<a>',1,'n@x.com','INBOX',0,0,100)`)
    const applyAction = vi.fn()
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'n@x.com', applyAction })
    expect(res.archivedCount).toBe(0)
    expect(applyAction).not.toHaveBeenCalled()
  })
  it('只扫 INBOX,不动 Archive/Trash 里的同发件人', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, is_deleted, received_at) VALUES
      (1,'<a>',1,'n@x.com','INBOX',0,0,100),(2,'<b>',1,'n@x.com','Archive',0,0,200)`)
    const res = await inboxSweep(db, { accountId: 1, fromEmail: 'n@x.com', applyAction: vi.fn().mockResolvedValue(undefined) })
    expect(res.archivedCount).toBe(0) // INBOX 只一封
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/rules/sweep.ts
export interface SweepResult { keptMessageId: number | null; archivedIds: number[]; archivedCount: number }

export async function inboxSweep(
  db: any,
  args: { accountId: number; fromEmail: string; keep?: number; applyAction: (db: any, opts: any) => Promise<void> },
): Promise<SweepResult> {
  const keep = args.keep ?? 1
  const email = args.fromEmail.toLowerCase().trim()
  const rows = db.prepare(`
    SELECT id FROM messages
    WHERE account_id = ? AND folder = 'INBOX' AND is_archived = 0 AND is_deleted = 0
      AND lower(sender) LIKE ?
    ORDER BY received_at DESC
  `).all(args.accountId, `%${email}%`) as { id: number }[]

  if (rows.length <= keep) {
    return { keptMessageId: rows[0]?.id ?? null, archivedIds: [], archivedCount: 0 }
  }
  const kept = rows[0].id
  const toArchive = rows.slice(keep).map((r) => r.id)
  // 批量归档:复用 applyAction archive(内部 adapter + UID 回写 + 乐观更新)
  if (toArchive.length) {
    await args.applyAction(db, { adapter: undefined, action: 'archive', messageIds: toArchive })
  }
  return { keptMessageId: kept, archivedIds: toArchive, archivedCount: toArchive.length }
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/sweep.ts src/__tests__/rules/sweep.test.ts
git commit -m "feat(rules): inbox sweep — archive old mail from a sender keeping newest"
git push
```

---

### Task 8: 规则 CRUD API

**Files:**
- Create: `src/app/api/rules/route.ts`、`src/app/api/rules/[id]/route.ts`
- Test: `src/__tests__/api/rules.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
// 用项目里既有的 API 测试风格(参考 plan-08 labels.test.ts):直接 import route handler + 构造 Request
import { GET as listGET, POST } from '@/app/api/rules/route'
import { GET as oneGET, PATCH, DELETE } from '@/app/api/rules/[id]/route'

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, { headers: { 'content-type': 'application/json' }, ...init })
}

describe('rules API', () => {
  it('POST /api/rules 创建规则', async () => {
    const res = await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: 'a@' }] }, actions: [{ type: 'star' }] }) }))
    expect(res.status).toBe(201)
    const r = (await res.json()).rule
    expect(r.id).toBeDefined()
    expect(r.conditions.conditions[0].value).toBe('a@')
  })
  it('POST 缺 name/conditions/actions → 400', async () => {
    const res = await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1 }) }))
    expect(res.status).toBe(400)
  })
  it('GET /api/rules?accountId=1 返回按 order 排序的列表', async () => {
    await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1, name: 'B', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1 }) }))
    await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1, name: 'A', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0 }) }))
    const res = await listGET(req('http://x/api/rules?accountId=1'))
    const ls = (await res.json()).rules
    expect(ls.map((r: any) => r.name)).toEqual(['A', 'B'])
  })
  it('PATCH /api/rules/[id] 改 name/actions + enabled', async () => {
    const created = await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [] }) }))
    const id = (await created.json()).rule.id
    const res = await PATCH(req(`http://x/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'R2', enabled: false }) }), { params: Promise.resolve({ id: String(id) }) })
    expect(res.status).toBe(200)
    const got = (await oneGET(req(`http://x/api/rules/${id}`), { params: Promise.resolve({ id: String(id) }) })).json ? await (await oneGET(req(`http://x/api/rules/${id}`), { params: Promise.resolve({ id: String(id) }) })).json() : null
    expect(got.rule.name).toBe('R2')
    expect(got.rule.enabled).toBe(false)
  })
  it('DELETE /api/rules/[id] → 规则消失', async () => {
    const created = await POST(req('http://x/api/rules', { method: 'POST', body: JSON.stringify({ accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [] }) }))
    const id = (await created.json()).rule.id
    await DELETE(req(`http://x/api/rules/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: String(id) }) })
    const got = await (await oneGET(req(`http://x/api/rules/${id}`), { params: Promise.resolve({ id: String(id) }) })).json()
    expect(got.rule).toBeNull()
  })
  it('PUT /api/rules/[id]/order 排序(可选:在 [id]/route 或独立)', async () => {
    // 排序端点:body { order: number } 单条,或列表端点 PUT /api/rules?accountId 重排
    // 这里测列表重排:PUT body { accountId, orderedIds: [id2, id1] }
    // (若实现为单条 PATCH order 亦可,二选一,本测试用列表重排)
  })
})
```

> **实现注：** `PATCH` 同时支持 `name/conditions/actions/enabled/kind` 任意子集（`enabled` 走 `setEnabled`，其余走 `updateRule`）。排序用 `PUT /api/rules?accountId=N` body `{ orderedIds: number[] }` → 按 index 赋 `order` 调 `reorderRules`。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `/api/rules/route.ts`**

```ts
// src/app/api/rules/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { createRule, listRules, reorderRules } from '@/lib/rules/repo'

export async function GET(req: Request) {
  const accountId = Number(new URL(req.url).searchParams.get('accountId'))
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  return NextResponse.json({ rules: listRules(getDb(), accountId) })
}

export async function POST(req: Request) {
  const b = await req.json()
  if (!b.accountId || !b.name || !b.conditions || !b.actions) {
    return NextResponse.json({ error: 'accountId, name, conditions, actions required' }, { status: 400 })
  }
  const id = createRule(getDb(), {
    accountId: b.accountId, name: b.name,
    conditions: b.conditions, actions: b.actions,
    order: b.order ?? 0, kind: b.kind ?? 'normal', enabled: b.enabled !== false,
  })
  return NextResponse.json({ rule: { id, ...b } }, { status: 201 })
}

export async function PUT(req: Request) {
  // 重排序:body { accountId, orderedIds: number[] }
  const b = await req.json()
  if (!b.accountId || !Array.isArray(b.orderedIds)) return NextResponse.json({ error: 'accountId + orderedIds required' }, { status: 400 })
  reorderRules(getDb(), b.orderedIds.map((id: number, i: number) => ({ id, order: i })))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: 实现 `/api/rules/[id]/route.ts`**

```ts
// src/app/api/rules/[id]/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRule, updateRule, setEnabled, deleteRule } from '@/lib/rules/repo'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return NextResponse.json({ rule: getRule(getDb(), Number(id)) })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const b = await req.json()
  const db = getDb()
  if (b.enabled !== undefined) setEnabled(db, Number(id), !!b.enabled)
  const patch: any = {}
  if (b.name !== undefined) patch.name = b.name
  if (b.conditions !== undefined) patch.conditions = b.conditions
  if (b.actions !== undefined) patch.actions = b.actions
  if (b.kind !== undefined) patch.kind = b.kind
  if (Object.keys(patch).length) updateRule(db, Number(id), patch)
  return NextResponse.json({ rule: getRule(db, Number(id)) })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  deleteRule(getDb(), Number(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/rules src/__tests__/api/rules.test.ts
git commit -m "feat(api): rules CRUD + reorder endpoints"
git push
```

---

### Task 9: 试跑端点（对历史邮件试跑预览）

**Files:**
- Create: `src/app/api/rules/[id]/test/route.ts`
- Test: `src/__tests__/api/rules-test.test.ts`

**关键设计：** 试跑**只算不执行**——给定一条规则（或 ruleId）+ 一个邮件范围（accountId 必填，可选 `fromEmail`/`folder`/`limit`，默认该账号全部收件箱邮件，`limit` 默认 200 防 OOM），对每封邮件组装 `RuleMessageContext` 调 `matchConditions`（不调 `applyActions`），返回 `{ total, matched: RuleTestHit[] }`。让用户在保存规则前预览「这条规则会命中哪些历史邮件」。端点也支持 body 内联 `{ conditions, actions }` 试跑（未保存的草稿规则）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/rules/[id]/test/route'
import { memDb } from '../../helpers/memDb'
// 注意:route handler 用 getDb();测试需注入内存库。若项目 route 测试用“直接调 handler + 预置 getDb 返回的库”,
// 则在测试顶部 mock @/lib/db 的 getDb 返回 memDb()。参考 plan-08 messages-batch.test.ts 的注入方式。

describe('POST /api/rules/[id]/test 试跑', () => {
  it('返回命中的历史邮件 + 将执行的动作(不实际执行)', async () => {
    const db = memDb()
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES
      (1,1,'R',1,'{"combinator":"and","conditions":[{"field":"from","operator":"contains","value":"alice@"}]}','[{"type":"move","targetFolder":"Archive"}]',0,'normal')`)
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, folder) VALUES
      (1,'<a>',1,'alice@x.com','Hi','b','INBOX'),
      (2,'<b>',1,'bob@x.com','Yo','b','INBOX')`)
    const res = await POST(new Request('http://x/api/rules/1/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1 }) }), { params: Promise.resolve({ id: '1' }) })
    const j = await res.json()
    expect(j.total).toBe(2)
    expect(j.matched.map((m: any) => m.messageId)).toEqual([1]) // 只 alice 命中
    expect(j.matched[0].actions[0].targetFolder).toBe('Archive')
    // 未执行:邮件 folder 仍 INBOX
    expect((db.prepare(`SELECT folder FROM messages WHERE id=1`).get() as any).folder).toBe('INBOX')
  })
  it('limit 截断扫描范围', async () => {
    const db = memDb()
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES (1,1,'R',1,'{"combinator":"and","conditions":[]}','[]',0,'normal')`)
    for (let i = 1; i <= 300; i++) db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder) VALUES (${i},'<m${i}>',1,'a@x.com','INBOX')`)
    const res = await POST(new Request('http://x/api/rules/1/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1, limit: 50 }) }), { params: Promise.resolve({ id: '1' }) })
    const j = await res.json()
    expect(j.total).toBe(50)
  })
  it('内联草稿规则(未保存)试跑:body 带 conditions', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder) VALUES (1,'<a>',1,'a@x.com','INBOX')`)
    const res = await POST(new Request('http://x/api/rules/0/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1, conditions: { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: 'a@' }] }, actions: [{ type: 'star' }] }) }), { params: Promise.resolve({ id: '0' }) })
    const j = await res.json()
    expect(j.matched.map((m: any) => m.messageId)).toEqual([1])
  })
  it('规则不存在 → 404', async () => {
    const db = memDb()
    const res = await POST(new Request('http://x/api/rules/999/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1 }) }), { params: Promise.resolve({ id: '999' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/app/api/rules/[id]/test/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRule } from '@/lib/rules/repo'
import { matchConditions } from '@/lib/rules/match'
import type { ConditionGroup, RuleAction, RuleMessageContext, RuleTestHit } from '@/lib/rules/types'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const b = await req.json()
  const db = getDb()
  const limit = Math.min(b.limit ?? 200, 1000)

  // 解析规则:优先用 ruleId 取已存规则;否则用 body 内联草稿(id=0 或 'draft')
  let conditions: ConditionGroup
  let actions: RuleAction[]
  let ruleName: string
  let ruleId: number | null
  if (b.conditions) {
    conditions = b.conditions; actions = b.actions ?? []; ruleName = b.name ?? '(草稿)'; ruleId = null
  } else {
    const r = getRule(db, Number(id))
    if (!r) return NextResponse.json({ error: 'rule not found' }, { status: 404 })
    conditions = r.conditions; actions = r.actions; ruleName = r.name; ruleId = r.id
  }

  // 扫描范围:该账号收件箱(可选 fromEmail 过滤)
  const where = [`account_id = ?`, `(folder = 'INBOX' OR folder IS NULL)`]
  const params: any[] = [b.accountId]
  if (b.fromEmail) { where.push(`lower(sender) LIKE ?`); params.push(`%${String(b.fromEmail).toLowerCase()}%`) }
  const rows = db.prepare(`SELECT id, sender, recipient, subject, body FROM messages WHERE ${where.join(' AND ')} ORDER BY received_at DESC LIMIT ?`).all(...params, limit) as any[]

  const matched: RuleTestHit[] = []
  for (const m of rows) {
    const labelIds = (db.prepare(`SELECT label_id FROM message_labels WHERE message_id = ?`).all(m.id) as any[]).map((r) => r.label_id)
    const att = (db.prepare(`SELECT count(*) c FROM attachments WHERE message_id = ?`).get(m.id) as any)?.c ?? 0
    const sizeKb = (db.prepare(`SELECT COALESCE(SUM(size),0) s FROM attachments WHERE message_id = ?`).get(m.id) as any)?.s ?? 0
    const ctxObj: RuleMessageContext = {
      messageId: m.id, accountId: b.accountId, from: m.sender ?? '', to: m.recipient ?? '', cc: '',
      subject: m.subject ?? '', body: m.body ?? '', hasAttachment: att > 0, sizeKb: Math.round(sizeKb / 1024),
      labelIds,
    }
    if (matchConditions(ctxObj, conditions)) {
      matched.push({ messageId: m.id, ruleId: ruleId ?? 0, ruleName, matched: true, actions })
    }
  }
  return NextResponse.json({ total: rows.length, matched })
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/rules/[id]/test/route.ts src/__tests__/api/rules-test.test.ts
git commit -m "feat(api): rule dry-run/test endpoint (match-only, no execution)"
git push
```

---

### Task 10: Inbox Sweep API

**Files:**
- Create: `src/app/api/rules/sweep/route.ts`
- Test: `src/__tests__/api/rules-sweep.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/rules/sweep/route'
import { memDb } from '../../helpers/memDb'

describe('POST /api/rules/sweep', () => {
  it('归档某发件人旧邮件,保留最新', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, received_at) VALUES
      (1,'<a>',1,'n@x.com','INBOX',0,100),(2,'<b>',1,'n@x.com','INBOX',0,200)`)
    const res = await POST(new Request('http://x/api/rules/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1, fromEmail: 'n@x.com' }) }))
    const j = await res.json()
    expect(j.archivedCount).toBe(1)
    expect(j.keptMessageId).toBe(2)
  })
  it('keep 可配', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, folder, is_archived, received_at) VALUES
      (1,'<a>',1,'n@x.com','INBOX',0,100),(2,'<b>',1,'n@x.com','INBOX',0,200),(3,'<c>',1,'n@x.com','INBOX',0,300)`)
    const res = await POST(new Request('http://x/api/rules/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 1, fromEmail: 'n@x.com', keep: 2 }) }))
    expect((await res.json()).archivedCount).toBe(1)
  })
  it('缺 accountId/fromEmail → 400', async () => {
    const res = await POST(new Request('http://x/api/rules/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/app/api/rules/sweep/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { inboxSweep } from '@/lib/rules/sweep'
import { getAdapter } from '@/lib/adapter' // plan-02
import { applyAction } from '@/lib/sync/writeback' // plan-03

export async function POST(req: Request) {
  const b = await req.json()
  if (!b.accountId || !b.fromEmail) return NextResponse.json({ error: 'accountId + fromEmail required' }, { status: 400 })
  const db = getDb()
  // 真实 applyAction(绑定 adapter):内部 getAdapter(accountId)
  const applyActionBound = (d: any, opts: any) => applyAction(d, { ...opts, adapter: getAdapter(b.accountId) })
  const res = await inboxSweep(db, { accountId: b.accountId, fromEmail: b.fromEmail, keep: b.keep, applyAction: applyActionBound })
  return NextResponse.json(res)
}
```

- [ ] **Step 4: 运行确认通过** → PASS（测试里 `applyAction` 会被 `getAdapter`/writeback 真实调用，故需在测试 mock `@/lib/adapter` 的 `getAdapter` 返回带 `move` 的 stub，或 mock `@/lib/sync/writeback` 的 `applyAction`——参考 plan-08 messages-batch.test.ts 的注入约定）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/rules/sweep/route.ts src/__tests__/api/rules-sweep.test.ts
git commit -m "feat(api): inbox sweep endpoint (keep newest, archive rest)"
git push
```

---

### Task 11: 规则编辑 UI（可视化条件构建器 + 动作 + 优先级 + 启停 + 试跑）

**Files:**
- Create: `src/app/rules/page.tsx`

- [ ] **Step 1: 规则列表页**：`GET /api/rules?accountId=<当前账号>` 渲染规则列表（含 order 顺序、enabled 开关、kind 徽标）。顶部「新建规则」+ 「白名单」「黑名单」快捷入口（弹输入框调 `addToList`）。拖拽排序 → `PUT /api/rules` body `{ accountId, orderedIds }`。

- [ ] **Step 2: 条件构建器**：编辑抽屉/弹窗。
  - combinator 切换（AND / OR）按钮组。
  - 条件行：`field` 下拉（from/subject/body/hasAttachment/size/label/to/cc）→ `operator` 下拉（按 field 动态过滤：字符串字段给 contains/equals/startsWith/endsWith/matchesRegex/notContains；hasAttachment 给 equals；size 给 gt/lt；label 给 equals）→ `value` 输入（size 用 number、hasAttachment 用 boolean 下拉、label 用标签选择器 `/api/labels`、其余 text）。可加/删条件行。

- [ ] **Step 3: 动作选择**：动作列表（可多条）。每条 `type` 下拉（move/markRead/markUnread/star/unstar/label/unlabel/forward/delete/priority/toTodo）→ 按 type 显示附加字段（move 选文件夹 `/api/folders`；label 选标签 `/api/labels` 多选；forward 输入地址；priority 选 high/normal/low）。

- [ ] **Step 4: 试跑**：编辑器内「试跑」按钮 → `POST /api/rules/0/test` body 内联 `{ accountId, conditions, actions }` → 右侧弹出命中邮件列表（subject + from + 预计动作），只读预览。确认无误再「保存」（`POST /api/rules`）。

- [ ] **Step 5: 启停 + 删除**：列表行 enabled switch → `PATCH /api/rules/[id] { enabled }`；删除按钮 → `DELETE`。

- [ ] **Step 6: Inbox Sweep 入口**：列表页或邮件详情页「对该发件人清理」按钮 → 弹确认（显示将归档 N 封、保留最新 1 封）→ `POST /api/rules/sweep`。

- [ ] **Step 7: 手测**：建一条 `from contains alice AND hasAttachment → move Archive + star`，试跑看到命中，保存后收一封 alice 带附件邮件验证自动归档+标星；切换 enabled 验证停用后不再匹配；拖拽改 order 验证 first-match-wins；白名单加 vip@ 后 vip 邮件不再被规则移动；Sweep 某发件人归档旧邮件。

- [ ] **Step 8: Commit**

```bash
git add src/app/rules/page.tsx
git commit -m "feat(ui): visual rule builder + actions + reorder + enable/disable + dry-run + sweep"
git push
```

---

### Task 12: Sidebar「规则」入口 + 账号切换

**Files:**
- Modify: `src/components/nav/Sidebar.tsx`

- [ ] **Step 1: Sidebar 增「规则与过滤器」入口** → `/rules`。当前选中账号（与收件箱账号切换一致）作为规则页的 `accountId` query。

- [ ] **Step 2: 手测**：从 Sidebar 进规则页，规则按当前账号加载；切换账号规则列表随之变。

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/Sidebar.tsx
git commit -m "feat(ui): rules entry in sidebar scoped to current account"
git push
```

---

## 验收标准

- [ ] `rules` 表存在（含 conditions/actions JSON、order、kind、enabled 索引）；迁移测试通过。
- [ ] 新收邮件经同步流水线「规则匹配」stage 处理：按 order 顺序 first-match-wins 匹配 enabled 普通规则，执行其 actions；本地动作（markRead/star/label/priority/转待办）即时生效；IMAP 动作（move/delete）经 `applyAction` + `MailAdapter` 用 UID 回写服务器并同步。
- [ ] **白名单**命中跳过所有规则（防误判）、**黑名单**命中直接 delete/trash——二者在引擎短路。
- [ ] conditions 支持组合：from / subject / body / hasAttachment / size / label / to / cc，operator 含 contains/equals/startsWith/endsWith/matchesRegex/notContains/gt/lt，combinator AND/OR，空条件通配；非法正则不抛异常按不命中处理。
- [ ] actions: move / markRead / markUnread / star / unstar / label / unlabel / forward / delete / priority / toTodo 全部可执行。
- [ ] 规则可创建/改名/改条件/改动作/启用停用/删除/拖拽排序（order 重排）。
- [ ] **试跑**：对历史邮件（可选 fromEmail/limit）算不执行预览，返回命中邮件 + 将执行动作；支持内联草稿规则试跑；规则不存在 404。
- [ ] **Inbox Sweep**：对某发件人 INBOX 邮件保留最新 N 封（默认 1）其余归档；只扫 INBOX 不动已归档/已删除；经 applyAction 回写服务器。
- [ ] 可视化规则编辑器：条件构建器（字段/操作符/值动态联动）+ 动作选择 + 优先级排序 + 启停 + 试跑预览；Sidebar「规则」入口按当前账号隔离。
- [ ] `npm test` 全绿（rules match/actions/repo/list/sweep、api rules/rules-test/rules-sweep、migration 补 rules）。
- [ ] `npx tsc --noEmit` 无类型错误。

## 依赖

- 子项目 1：drizzle 迁移框架（建 `rules` 表）+ messages `account_id/folder/imap_uid/is_archived/priority` 列 + 修 body 截断（规则 `body` 条件需全文）。
- 子项目 2：`accounts` 表 + `getAdapter(accountId): MailAdapter` + `MailAdapter.send`（forward）。
- 子项目 3：`applyAction`（`move/delete/markRead/star/archive` 的 UID 回写 + 乐观更新/回滚 + folders 语义）——本子项目 move/delete/markRead/star 动作全经它。
- 子项目 6：同步队列/`incrementalSync` 的 stage（规则引擎挂入库后的「规则匹配」stage；若 stage 未抽象则在 scheduler/fetch route 内联接线）。
- 子项目 8：`labels`/`message_labels` + `attachLabels`/`detachLabel`（label/unlabel 动作 + label 条件联动）。

## 风险

- **first-match-wins vs 全部应用**：本设计选 first-match-wins（一条邮件命中首条规则即停），避免一封邮件被多条 move 规则反复移动导致 folder 抖动。代价：用户若想让「标星」和「移动」分两条规则，需合并到一条规则的多 action。UI 文案须说明此语义。
- **priority 列依赖**：`priority` 动作写 `messages.priority` 列，要求子项目 1 已加该列。**若未加**，降级方案：把 priority 映射成贴 `Priority:High/Medium/Low` 标签（用 `attachLabels` + 自动创建标签），不阻塞——实现时先 `PRAGMA table_info(messages)` 检测列存在，无则走降级，并记 TODO。
- **试跑性能**：历史邮件量大时试跑逐封组装 context（含 attachments 聚合 + labels 查询）慢。缓解：`limit` 默认 200、上限 1000；attachments size 聚合可用单条 `SUM` 子查询（已实现）。本地单机可接受。
- **规则引擎阻塞事件循环**：better-sqlite3 同步 API；`runRulesForMessage` 逐条 match + applyAction 是同步 DB + await IMAP 回写。新邮件到达时若规则多 + IMAP move 慢会阻塞 IDLE 回调。缓解：接线处用 `setImmediate` 让出（与 plan-06 NFR 一致）；move/delete 经 jobs 队列异步化（子项目 6 已有 jobs，规则动作可入队而非同步执行）。
- **applyAction adapter 注入**：规则引擎把 adapter 职责完全委托给注入的 `applyAction`，故接线时必须传「已绑定 `getAdapter(accountId)`」的真实 applyAction；测试用 mock。若误传未绑定版本，move/delete 会跳过 IMAP 回写（仅本地）——验收时务必手测「移动后服务器侧文件夹也变」。
- **白/黑名单误判**：白名单 from-contains 可能过宽（`a@` 命中 `a@x.com` 也命中 `ba@x.com`）。缓解：UI 提示用完整邮箱；匹配大小写不敏感但子串语义需用户知晓。
- execute 前补全每个任务的 TDD 微步骤（先红后绿）；route handler 测试的 `getDb()` 注入约定参考 plan-08 messages-batch.test.ts。
