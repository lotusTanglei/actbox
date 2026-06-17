# 子项目 8 — 组织整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 webmail 加上标签系统、会话/线索视图、批量操作、Snooze（延后回顶提醒）、邮件一键转待办——把收件箱从"平铺星标列表"组织成可分类、可折叠、可批量、可延后、可转任务的协作面。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 8）。本地单机、单进程、单 SQLite(WAL)。`labels` + `message_labels` 关联表承载多标签/着色（按 `account_id` 隔离，嵌套用 `parent_id` 自引用）。会话聚合在**入库时**计算 `thread_id`：优先用 `In-Reply-To`/`References` 头解析出的根 `Message-ID`，回退到规范化 Subject（去 `Re:`/`Fwd:`/`Fw:` 前缀 + 大小写折叠），同根同 Subject 归一个 `thread_id`（列由子项目 1 已加）。批量操作复用子项目 3 的 `applyAction`（`move/archive/delete/markRead/star`），新增 `label`/`unlabel` 动作。Snooze 用子项目 1 已加的 `snoozed_until` 列（UTC 存储），node-cron 每分钟扫描到期邮件清字段并通过 `refresh-bus` 触发回顶提醒。邮件转待办复用现有 `todos.sourceMessageId` 关联 + `/api/todos` POST，补 UI 入口与回写 `todo_count`。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / node-cron / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 1（messages `thread_id`/`snoozed_until`/`account_id` 列 + drizzle 迁移框架 + `messages.account_id`）与子项目 3（`applyAction` 批量移动/归档/删除/标记/标星的 UID 回写 + folders 语义）。阶段 3 执行——执行前补全 TDD 微步骤（每任务先写失败测试再实现）。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — `labels` / `message_labels` 表（Task 1）
- Create: `src/lib/threads/normalize.ts` — 规范化 Subject + In-Reply-To/References 解析（Task 2）
- Create: `src/lib/threads/assign.ts` — 入库时计算并写 `thread_id`（Task 3）
- Create: `src/lib/labels/repo.ts` — labels/message_labels 读写（Task 4）
- Create: `src/lib/labels/apply.ts` — 批量贴/撕标签（Task 5）
- Modify: `src/lib/sync/writeback.ts`（子项目 3）— `applyAction` 增 `label`/`unlabel` 动作（Task 5）
- Create: `src/lib/snooze/index.ts` — Snooze 置位/取消 + 到期扫描任务（Task 6）
- Modify: `src/app/api/messages/route.ts` — GET 增 `labelId`/`thread` 过滤与排序（Task 7）
- Create: `src/app/api/messages/batch/route.ts` — POST 批量操作（Task 8）
- Create: `src/app/api/messages/[id]/snooze/route.ts` — POST/PATCH 单封/批量 Snooze（Task 6/8）
- Create: `src/app/api/labels/route.ts`、`src/app/api/labels/[id]/route.ts` — 标签 CRUD（Task 9）
- Create: `src/app/api/messages/[id]/todo/route.ts` — POST 邮件一键转待办（Task 10）
- Modify: `src/app/mails/page.tsx` — 多选 + 范围选 + 批量工具栏 + 会话折叠/展开（Task 11）
- Modify: `src/components/nav/Sidebar.tsx` — 标签区（带颜色）+ Snoozed 视图入口（Task 12）
- Modify: `src/app/mails/[id]/page.tsx` — "转待办"/"贴标签"/"Snooze" 按钮（Task 12）
- Test: `src/__tests__/threads/normalize.test.ts`、`src/__tests__/threads/assign.test.ts`、`src/__tests__/labels/repo.test.ts`、`src/__tests__/labels/apply.test.ts`、`src/__tests__/snooze/snooze.test.ts`、`src/__tests__/api/messages-batch.test.ts`、`src/__tests__/api/labels.test.ts`、`src/__tests__/api/message-todo.test.ts`、`src/__tests__/api/messages-filter.test.ts`

---

## 任务

### Task 1: labels / message_labels 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 加 labels 与 message_labels 表**

```ts
/** 标签（按账号隔离，支持嵌套与着色） */
export const labels = sqliteTable('labels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  parentId: integer('parent_id'),                 // 嵌套父标签 id（null=顶层）
  name: text('name').notNull(),
  color: text('color').notNull().default('#6b7280'), // 十六进制颜色
}, (t) => ({
  accNameUq: uniqueIndex('uq_labels_account_name').on(t.accountId, t.name),
  accParentIdx: index('idx_labels_account_parent').on(t.accountId, t.parentId),
}))

/** 邮件-标签关联（多对多） */
export const messageLabels = sqliteTable('message_labels', {
  messageId: integer('message_id').notNull(),
  labelId: integer('label_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.labelId] }),
  labelIdx: index('idx_message_labels_label').on(t.labelId),
}))
```

- [ ] **Step 2: 生成迁移** `npm run db:generate`（产出 labels / message_labels 建表 SQL，含唯一索引与复合主键）。

- [ ] **Step 3: 运行迁移测试确认两表存在** `npx vitest run src/__tests__/db/migration.test.ts` → PASS（迁移测试需覆盖 labels/message_labels 行）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): labels + message_labels tables for tagging"
git push
```

---

### Task 2: Subject 规范化 + In-Reply-To/References 解析

**Files:**
- Create: `src/lib/threads/normalize.ts`
- Test: `src/__tests__/threads/normalize.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeSubject, extractRootMessageId } from '@/lib/threads/normalize'

describe('normalizeSubject', () => {
  it('去除 Re:/Fwd:/Fw: 前缀（多层）并折叠空白/大小写', () => {
    expect(normalizeSubject('Re: Re: 周报')).toBe('周报')
    expect(normalizeSubject('Fwd: Fw: RE: Weekly Report')).toBe('weekly report')
    expect(normalizeSubject('  [External] Re: Hello  ')).toBe('[external] hello')
  })
  it('空/null → 空串', () => {
    expect(normalizeSubject(null as any)).toBe('')
    expect(normalizeSubject('')).toBe('')
  })
})

describe('extractRootMessageId', () => {
  it('References 取第一个（最老）作为根', () => {
    expect(extractRootMessageId({ inReplyTo: '<b@x>', references: '<a@x> <b@x>' })).toBe('a@x')
  })
  it('无 References 则用 In-Reply-To', () => {
    expect(extractRootMessageId({ inReplyTo: '<b@x>', references: null })).toBe('b@x')
  })
  it('两者都无返回 null', () => {
    expect(extractRootMessageId({ inReplyTo: null, references: null })).toBeNull()
  })
  it('去尖括号', () => {
    expect(extractRootMessageId({ inReplyTo: '  <c@d>  ', references: null })).toBe('c@d')
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/threads/normalize.test.ts` → FAIL。

- [ ] **Step 3: 实现**
  - `normalizeSubject(subject: string | null): string`：小写化 → 正则反复剥离开头的 `re:`/`aw:`/`fwd:`/`fw:`/`wg:` 等前缀（含中括号变体 `[xxx]`）与多余空白，`trim().replace(/\s+/g,' ')`，空/null 返回 `''`。
  - `extractRootMessageId(headers: { inReplyTo: string | null; references: string | null }): string | null`：优先 `references`（空格分隔的 `<id>` 列表）取**第一个**（最老根），去尖括号；否则 `inReplyTo` 去尖括号；皆无返回 `null`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/threads/normalize.ts src/__tests__/threads/normalize.test.ts
git commit -m "feat(threads): normalize subject + parse In-Reply-To/References root"
git push
```

---

### Task 3: 入库时计算并写 thread_id

**Files:**
- Create: `src/lib/threads/assign.ts`
- Test: `src/__tests__/threads/assign.test.ts`

**关键设计：** `thread_id` 取值 = `extractRootMessageId(headers) ?? normalizeSubject(subject) ?? messageId`。入库前先查"同 account 下 thread_id 已存在？" —— 若 References/In-Reply-To 的根 messageId 对应某封已入库邮件，则**复用那封的 thread_id**（保证回复链贴在同一会话）；否则用规范化 Subject 在同 account 内找首封同 Subject 的 thread_id 复用；都没有则以候选值新建 thread_id。这样 `Re: 周报` 的回复会落到"周报"会话。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { computeThreadId } from '@/lib/threads/assign'

describe('computeThreadId', () => {
  it('有 References 根且已入库该 messageId → 复用其 thread_id', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, thread_id) VALUES (1,'<root@x>',1,'周报','T-weekly')`)
    const tid = computeThreadId(db, { accountId: 1, messageId: '<r2@x>', subject: 'Re: 周报', inReplyTo: '<root@x>', references: '<root@x>' })
    expect(tid).toBe('T-weekly')
  })
  it('无根但规范化 Subject 同 account 有先例 → 复用同 subject 的 thread_id', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, thread_id) VALUES (1,'<a>',1,'周报','S-周报')`)
    const tid = computeThreadId(db, { accountId: 1, messageId: '<b>', subject: 'Re: 周报', inReplyTo: null, references: null })
    expect(tid).toBe('S-周报')
  })
  it('全新会话 → 用根 messageId 作 thread_id', () => {
    const db = memDb()
    const tid = computeThreadId(db, { accountId: 1, messageId: '<new>', subject: '新主题', inReplyTo: null, references: null })
    expect(tid).toBe('<new>')
  })
  it('规范化后为空且无根 → 用自身 messageId', () => {
    const db = memDb()
    const tid = computeThreadId(db, { accountId: 1, messageId: '<x>', subject: '   ', inReplyTo: null, references: null })
    expect(tid).toBe('<x>')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `computeThreadId(db, { accountId, messageId, subject, inReplyTo, references }): string`**
  1. `rootMid = extractRootMessageId({inReplyTo, references})`。
  2. 若 `rootMid`：查 `SELECT thread_id FROM messages WHERE account_id=? AND message_id=? LIMIT 1`（去尖括号匹配，注意存库 messageId 可能带尖括号，用 `message_id IN (rootMid, '<'+rootMid+'>')`）。命中 → 返回该 thread_id。
  3. `norm = normalizeSubject(subject)`。若非空：查 `SELECT thread_id FROM messages WHERE account_id=? AND thread_id IS NOT NULL ORDER BY id LIMIT 1`，但需按"同规范化 Subject"匹配——存库时无规范化列，故改为查同 account 所有行在 JS 里 `normalizeSubject(row.subject)===norm` 取首行的 thread_id 复用（邮件量本地单机可接受；超大批量留 TODO 用物化列）。命中 → 返回。
  4. 回退：`return messageId`（去尖括号）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 在入库路径接 `computeThreadId`**：`src/lib/scheduler/index.ts` 与 `src/app/api/fetch/route.ts`、`src/app/api/send/route.ts` 的 `db.insert(messages)` 前调 `computeThreadId` 写 `threadId` 字段（需先把消息头的 `inReplyTo`/`references` 透传到 insert 处；若 plan-01 的 `RawMessage` 已带这俩字段则直接用，否则补解析）。**此步无新测试**（已由 Task 3 覆盖核心逻辑），仅改接线 + 手测一封回复邮件归到原会话。

- [ ] **Step 6: Commit**

```bash
git add src/lib/threads/assign.ts src/__tests__/threads/assign.test.ts src/lib/scheduler/index.ts src/app/api/fetch/route.ts src/app/api/send/route.ts
git commit -m "feat(threads): compute thread_id on ingest via References/In-Reply-To/normalized subject"
git push
```

---

### Task 4: labels / message_labels repo

**Files:**
- Create: `src/lib/labels/repo.ts`
- Test: `src/__tests__/labels/repo.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { createLabel, listLabels, attachLabels, detachLabel, labelsOf } from '@/lib/labels/repo'

describe('labels repo', () => {
  it('createLabel 唯一(account_id,name) 重复返回既有', () => {
    const db = memDb()
    const a = createLabel(db, { accountId: 1, name: '重要', color: '#ef4444' })
    const b = createLabel(db, { accountId: 1, name: '重要', color: '#000' })
    expect(a.id).toBe(b.id)
    expect(b.color).toBe('#ef4444') // 不覆盖
  })
  it('attachLabels 幂等 + labelsOf 返回', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const lab = createLabel(db, { accountId: 1, name: 'L1' })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] }) // 幂等
    const ls = labelsOf(db, 1)
    expect(ls.map(l => l.name)).toEqual(['L1'])
  })
  it('detachLabel 删除关联', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const lab = createLabel(db, { accountId: 1, name: 'L1' })
    attachLabels(db, { messageIds: [1], labelIds: [lab.id] })
    detachLabel(db, { messageId: 1, labelId: lab.id })
    expect(labelsOf(db, 1)).toHaveLength(0)
  })
  it('listLabels 按 account 含 parentId 嵌套', () => {
    const db = memDb()
    const p = createLabel(db, { accountId: 1, name: 'P' })
    createLabel(db, { accountId: 1, name: 'C', parentId: p.id })
    const ls = listLabels(db, 1)
    expect(ls).toHaveLength(2)
    expect(ls.find(l => l.name === 'C')?.parentId).toBe(p.id)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `createLabel(db, { accountId, name, color?, parentId? })`：`INSERT ... ON CONFLICT(account_id,name) DO NOTHING RETURNING *`，若 returning 为空（冲突）则 `SELECT` 返回既有（不覆盖 color）。
  - `updateLabel(db, id, patch)`、`deleteLabel(db, id)`（级联 `DELETE FROM message_labels WHERE label_id=?`）。
  - `listLabels(db, accountId)`：返回该账号全部标签（含 parentId/color）。
  - `attachLabels(db, { messageIds, labelIds })`：对每 (msg,label) `INSERT OR IGNORE INTO message_labels`。
  - `detachLabel(db, { messageId, labelId })`：`DELETE FROM message_labels WHERE message_id=? AND label_id=?`。
  - `labelsOf(db, messageId)`：join labels 返回该邮件标签列表。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/labels/repo.ts src/__tests__/labels/repo.test.ts
git commit -m "feat(labels): labels/message_labels repo with idempotent attach/detach"
git push
```

---

### Task 5: 批量贴/撕标签 + writeback 增 label/unlabel

**Files:**
- Create: `src/lib/labels/apply.ts`
- Modify: `src/lib/sync/writeback.ts`（子项目 3 的 `applyAction`，action 枚举增 `label`/`unlabel`）
- Test: `src/__tests__/labels/apply.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { applyLabels } from '@/lib/labels/apply'

describe('applyLabels 批量贴/撕', () => {
  it('批量给多封贴多标签', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m1>',1,'s'),(2,'<m2>',1,'s')`)
    const a = createLabel(db, { accountId: 1, name: 'A' })
    const b = createLabel(db, { accountId: 1, name: 'B' })
    const stats = applyLabels(db, { messageIds: [1, 2], labelIds: [a.id, b.id], mode: 'attach' })
    expect(stats.affected).toBe(4) // 2 msg × 2 label
    expect(db.prepare('SELECT count(*) c FROM message_labels').get()).toMatchObject({ c: 4 })
  })
  it('detach 模式删除关联', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m1>',1,'s')`)
    const a = createLabel(db, { accountId: 1, name: 'A' })
    applyLabels(db, { messageIds: [1], labelIds: [a.id], mode: 'attach' })
    applyLabels(db, { messageIds: [1], labelIds: [a.id], mode: 'detach' })
    expect(db.prepare('SELECT count(*) c FROM message_labels').get()).toMatchObject({ c: 0 })
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `applyLabels(db, { messageIds, labelIds, mode: 'attach' | 'detach' }): { affected: number }`**：事务内逐对调 repo 的 `attachLabels`/`detachLabel`，统计影响行数。`attach` 用 `INSERT OR IGNORE`（幂等，重复不计入 affected）。

- [ ] **Step 4: 扩展 `applyAction`（子项目 3 writeback.ts）**：在 action 枚举加 `'label' | 'unlabel'`。`label` → `applyLabels(db,{messageIds,labelIds,mode:'attach'})`；`unlabel` → `mode:'detach'`。标签是纯本地概念（不回写 IMAP），无需调 adapter，无乐观回滚需求。`applyAction` 签名增可选 `labelIds?: number[]`。

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/labels/apply.ts src/lib/sync/writeback.ts src/__tests__/labels/apply.test.ts
git commit -m "feat(labels): batch attach/detach + applyAction label/unlabel"
git push
```

---

### Task 6: Snooze 置位/取消 + 到期扫描

**Files:**
- Create: `src/lib/snooze/index.ts`
- Create: `src/app/api/messages/[id]/snooze/route.ts`
- Test: `src/__tests__/snooze/snooze.test.ts`

**关键设计：** `snoozed_until` 存 **UTC epoch ms**（与 spec 时区 NFR 一致）。`snoozeMessage(db,{messageIds, until})`：置 `snoozed_until=until`（ISO/epoch），把邮件移出当前视图（列表默认 WHERE `snoozed_until IS NULL OR snoozed_until <= now`）。`unsnooze` 清字段。`runSnoozeAwake(db, { onDue })`：扫描 `snoozed_until IS NOT NULL AND snoozed_until <= now` → 清 `snoozed_until=NULL`（回到顶部）+ 标记 `is_read=false`（变未读以提醒）+ 调 `onDue(messageIds)` 触发 `refresh-bus.emitRefresh()` + 桌面通知（子项目 6 接，此处留 hook）。node-cron `* * * * *`（每分钟）跑 `runSnoozeAwake`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { snoozeMessage, unsnoozeMessage, runSnoozeAwake } from '@/lib/snooze'

describe('Snooze', () => {
  it('snoozeMessage 置 snoozed_until (UTC epoch ms)', () => {
    const db = memDb()
    const until = Date.now() + 3600_000
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    snoozeMessage(db, { messageIds: [1], until })
    expect((db.prepare('SELECT snoozed_until FROM messages WHERE id=1').get() as any).snoozed_until).toBe(until)
  })
  it('unsnoozeMessage 清字段', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, snoozed_until) VALUES (1,'<m>',1,'s',${Date.now()+1000})`)
    unsnoozeMessage(db, { messageIds: [1] })
    expect((db.prepare('SELECT snoozed_until FROM messages WHERE id=1').get() as any).snoozed_until).toBeNull()
  })
  it('runSnoozeAwake 到期邮件清字段+标未读+触发回调', () => {
    const db = memDb()
    const past = Date.now() - 1000
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, snoozed_until, is_read) VALUES (1,'<m>',1,'s',${past},1),(2,'<m2>',1,'s',${Date.now()+9999},1)`)
    const onDue = vi.fn()
    const stats = runSnoozeAwake(db, { now: Date.now(), onDue })
    expect(stats.woke).toBe(1)
    const r = db.prepare('SELECT snoozed_until, is_read FROM messages WHERE id=1').get() as any
    expect(r.snoozed_until).toBeNull()
    expect(r.is_read).toBe(0) // 标未读提醒
    expect(onDue).toHaveBeenCalledWith([1])
    // 未到期的不动
    expect((db.prepare('SELECT snoozed_until FROM messages WHERE id=2').get() as any).snoozed_until).not.toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `snoozeMessage(db, { messageIds: number[], until: number })`：`UPDATE messages SET snoozed_until=? WHERE id IN (...)`。
  - `unsnoozeMessage(db, { messageIds })`：`UPDATE ... SET snoozed_until=NULL`。
  - `runSnoozeAwake(db, { now = Date.now(), onDue }): { woke: number }`：`SELECT id FROM messages WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?` → 对这些 id `UPDATE SET snoozed_until=NULL, is_read=0` → `onDue(ids)` → 返回 woke 数。
  - 启动 cron：在 `src/lib/scheduler/index.ts`（或新 `src/lib/snooze/scheduler.ts`）`cron.schedule('* * * * *', () => runSnoozeAwake(getDb(), { onDue: () => import('@/lib/refresh-bus').then(b => b.emitRefresh()) }))`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 实现 `POST/PATCH /api/messages/[id]/snooze/route.ts`**：body `{ until: number }` → `snoozeMessage`；`{ action: 'cancel' }` → `unsnoozeMessage`。返回 200。支持 body `{ messageIds: number[], until }` 批量（与 Task 8 批量复用同一逻辑）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/snooze/index.ts src/lib/snooze/scheduler.ts src/app/api/messages/[id]/snooze/route.ts src/__tests__/snooze/snooze.test.ts
git commit -m "feat(snooze): set/cancel snoozed_until + per-minute awake sweep to top"
git push
```

---

### Task 7: 列表过滤 — 按标签 / 会话折叠

**Files:**
- Modify: `src/app/api/messages/route.ts`
- Test: `src/__tests__/api/messages-filter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('GET /api/messages 过滤', () => {
  it('?labelId=1 只返回贴该标签的邮件', async () => { /* seed msg1 贴 label、msg2 不贴 → 返回仅 msg1 */ })
  it('默认排除 snoozed 未到期邮件 (snoozed_until > now)', async () => { /* seed 一封未来 snooze、一封普通 → 只返回普通 */ })
  it('?thread=group 按 thread_id 聚合返回会话头（每会话最新一封 + count）', async () => { /* seed 同 thread_id 两封 → 返回 1 行 count=2 */ })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - 基础条件追加 `snoozed_until IS NULL OR snoozed_until <= ?`（`?=now`），让延后邮件在到期前从默认列表隐藏。
  - `?labelId=N`：`messages.id IN (SELECT message_id FROM message_labels WHERE label_id=N)`。
  - `?thread=group`：按 `thread_id` `GROUP BY`，返回 `{ threadId, latestMessage, count, unreadCount }` 列表（会话头）。`?threadId=X` 展开：`WHERE thread_id=X` 返回该会话全部邮件。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messages/route.ts src/__tests__/api/messages-filter.test.ts
git commit -m "feat(api): filter by label + hide snoozed + thread group view"
git push
```

---

### Task 8: 批量操作 API

**Files:**
- Create: `src/app/api/messages/batch/route.ts`
- Test: `src/__tests__/api/messages-batch.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('POST /api/messages/batch', () => {
  it('批量 archive 调 applyAction archive', async () => { /* body {messageIds:[1,2], action:'archive'} → 200, 两封 is_archived=1 */ })
  it('批量 markRead value=true', async () => { /* 两封 is_read=1 */ })
  it('批量 label 带 labelIds', async () => { /* 两封贴上 label */ })
  it('批量 move 带 targetFolder', async () => { /* folder 变更 */ })
  it('批量 delete', async () => { /* is_deleted=1 */ })
  it('非法 action → 400', async () => {})
  it('空 messageIds → 400', async () => {})
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `POST /api/messages/batch`**：body `{ messageIds: number[], action: 'markRead'|'star'|'move'|'archive'|'restore'|'delete'|'label'|'unlabel'|'snooze', value?, targetFolder?, labelIds?, until? }`。
  - 校验：`messageIds` 非空数组、`action` 在枚举内 → 否则 400。
  - `action` ∈ move/archive/restore/delete/markRead/star/label/unlabel → `applyAction(db, { adapter: getAdapter(accountId), action, messageIds, value, targetFolder, labelIds })`（标签动作不需要 adapter，applyAction 内部分流）。
  - `action==='snooze'` → `snoozeMessage(db, { messageIds, until })`。
  - 返回 `{ updated: messageIds.length }`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messages/batch/route.ts src/__tests__/api/messages-batch.test.ts
git commit -m "feat(api): batch operations endpoint (archive/delete/mark/star/label/move/snooze)"
git push
```

---

### Task 9: 标签 CRUD API

**Files:**
- Create: `src/app/api/labels/route.ts`、`src/app/api/labels/[id]/route.ts`
- Test: `src/__tests__/api/labels.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('labels API', () => {
  it('POST /api/labels 创建标签', async () => { /* {accountId,name,color} → 201, 返回 label */ })
  it('POST 同名重复返回既有 200', async () => {})
  it('GET /api/labels?accountId=1 列表', async () => {})
  it('PATCH /api/labels/[id] 改名/改色/改父', async () => {})
  it('DELETE /api/labels/[id] 删除 + 级联 message_labels', async () => { /* message_labels 行清零 */ })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `POST /api/labels`：`createLabel`。
  - `GET /api/labels?accountId=`：`listLabels`。
  - `PATCH /api/labels/[id]`：`updateLabel`（name/color/parentId）。
  - `DELETE /api/labels/[id]`：`deleteLabel`（repo 内级联删 message_labels）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/labels src/__tests__/api/labels.test.ts
git commit -m "feat(api): labels CRUD with cascade delete"
git push
```

---

### Task 10: 邮件一键转待办 API

**Files:**
- Create: `src/app/api/messages/[id]/todo/route.ts`
- Test: `src/__tests__/api/message-todo.test.ts`

**关键设计：** 复用现有 `todos` 表 + `sourceMessageId`（存 message 的 `message_id` 字符串，与现有 `extractor`/`scheduler` 一致）。POST 创建一条 todo 并回写 `messages.todo_count`（+1）。前端 `mails/[id]/page.tsx` 已按 `t.sourceMessageId === message.messageId` 过滤关联待办（见现状代码），故新建后自动出现在关联列表。

- [ ] **Step 1: 写失败测试**

```ts
describe('POST /api/messages/[id]/todo', () => {
  it('从邮件创建待办: title 取 subject, sourceMessageId 取 message.messageId', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m@x>',1,'确认需求')`)
    const res = await POST(req({ params: { id: '1' }, body: { title: '确认需求', priority: 'high' } }))
    const todo = (await res.json()).todo
    expect(todo.sourceMessageId).toBe('<m@x>')
    expect(todo.sourceSubject).toBe('确认需求')
    expect((db.prepare('SELECT todo_count FROM messages WHERE id=1').get() as any).todo_count).toBe(1)
  })
  it('无 title 回退用 subject', async () => {})
  it('邮件不存在 → 404', async () => {})
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `POST /api/messages/[id]/todo`**：
  1. 取 message 行（`SELECT * FROM messages WHERE id=?`）→ 不存在 404。
  2. `title = body.title || message.subject`；`sourceMessageId = message.messageId`；`sourceSubject = message.subject`；`sourceFrom = message.from`；可选 `dueDate/priority/context`。
  3. 事务内 `INSERT INTO todos (...) RETURNING *` + `UPDATE messages SET todo_count = todo_count + 1 WHERE id=?`。
  4. 返回 `{ todo }` 201。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messages/[id]/todo/route.ts src/__tests__/api/message-todo.test.ts
git commit -m "feat(api): one-click message → todo via sourceMessageId + todo_count bump"
git push
```

---

### Task 11: 列表 UI — 多选 / 范围选 / 批量工具栏 / 会话折叠

**Files:**
- Modify: `src/app/mails/page.tsx`

- [ ] **Step 1: 多选**：每行加 checkbox；维护 `Set<number> selectedIds`。Shift+click 范围选（记录上次勾选行 index，区间全选）。
- [ ] **Step 2: 批量工具栏**：选中非空时顶部出现工具栏——归档/删除/标记已读/标星/移动文件夹/贴标签/Snooze；点击 → `POST /api/messages/batch` → 成功后清选 + `emitRefresh()`。
- [ ] **Step 3: 会话视图**：默认列表按会话折叠（`GET /api/messages?thread=group`），每行显示会话最新邮件 + 邮件数角标 + 未读数；点击展开 `?threadId=X` 拉取该会话全部邮件缩进展示。提供"平铺/会话"切换。
- [ ] **Step 4: 标签着色**：行尾按 `labelsOf` 渲染标签小色块（点色块按该 label 过滤）。
- [ ] **Step 5: 手测**：多选 3 封批量归档生效；Shift 范围选正确；会话折叠/展开；标签过滤生效。

- [ ] **Step 6: Commit**

```bash
git add src/app/mails/page.tsx
git commit -m "feat(ui): multi-select + shift-range + batch toolbar + collapsible thread view"
git push
```

---

### Task 12: Sidebar 标签区 + Snoozed 入口 + 详情页操作按钮

**Files:**
- Modify: `src/components/nav/Sidebar.tsx`、`src/app/mails/[id]/page.tsx`

- [ ] **Step 1: Sidebar 标签区**：从 `/api/labels` 渲染标签列表（带颜色圆点 + 嵌套缩进）；点击 → `?labelId=N` 过滤列表。顶部增"已延后 (Snoozed)"入口 → 显示 `snoozed_until IS NOT NULL` 的邮件列表（含剩余时间）。
- [ ] **Step 2: 详情页按钮**：邮件详情页加三个操作——"转待办"（`POST /api/messages/[id]/todo` → 成功后刷新关联待办）、"贴标签"（下拉选标签 → 批量贴该封）、"Snooze"（选 1h/今晚/明天上午/自定义 → `POST /api/messages/[id]/snooze`）。操作后 `emitRefresh()`。
- [ ] **Step 3: 手测**：标签区过滤生效；点"已延后"看延后列表；转待办后详情页出现关联待办；Snooze 后邮件从默认列表消失、到点回顶变未读。

- [ ] **Step 4: Commit**

```bash
git add src/components/nav/Sidebar.tsx src/app/mails/[id]/page.tsx
git commit -m "feat(ui): label nav + snoozed view + detail-page todo/label/snooze actions"
git push
```

---

## 验收标准

- [ ] 一封邮件可贴多个标签、标签可嵌套（parent）与着色；列表按标签过滤、行尾着色正确。
- [ ] 会话视图：回复邮件（`Re:`/`Fwd:` 或带 References）聚合同一会话；列表可折叠/展开会话；切换平铺/会话正常。
- [ ] 列表多选（含 Shift 范围选）后批量归档/删除/标记已读/标星/贴标签/移动文件夹均生效。
- [ ] Snooze：延后邮件从默认列表隐藏、进入"已延后"视图；到点（≤1 分钟粒度）回到顶部并变未读提醒。
- [ ] 邮件一键转待办：创建 todo 且 `sourceMessageId` 关联、`todo_count` +1、详情页关联待办列表实时刷新。
- [ ] `npm test` 全绿（threads normalize/assign、labels repo/apply、snooze、messages-filter、messages-batch、labels、message-todo API）。
- [ ] `npx tsc --noEmit` 无类型错误。

## 依赖

- 子项目 1：messages `thread_id`/`snoozed_until`/`account_id` 列 + drizzle 迁移框架（建 `labels`/`message_labels` 表用）。
- 子项目 3：`applyAction`（`move/archive/delete/markRead/star` 的 UID 回写 + folders 语义）——本子项目在其上增 `label`/`unlabel`。

## 风险

- **会话聚合准确性**：仅靠 Subject 回退会误聚（不同人发同名"周报"）。缓解：优先用 References/In-Reply-To 根 messageId；Subject 仅在同 account 内作弱回退，且注明未来可加物化 `normalized_subject` 列 + 索引提性能。
- **thread_id 回填**：存量邮件（子项目 1 之前入库的）无 thread_id，需一次性回填脚本遍历重算（可作为 Task 3 的可选 backfill 步骤，受保留期限制时部分行跳过）。
- **Snooze 时区**：`snoozed_until` 必须存 UTC（spec NFR 时区）；前端"今晚/明天上午"需在客户端按本地时区算出 UTC ms 再传。
- **批量操作 UID 回写**：批量 `move/delete/markRead` 经子项目 3 的 `applyAction` 逐条 UID 回写 IMAP，量大时慢/部分失败——需依赖 applyAction 的事务回滚 + jobs 重试，UI 给部分失败提示。
- **标签不回写服务器**：标签是本地概念，不同步到 IMAP（Gmail 的标签=文件夹是另一套，P2 再适配）；需在 UI 文案说明。
- execute 前补全每个任务的 TDD 微步骤（先红后绿）。
