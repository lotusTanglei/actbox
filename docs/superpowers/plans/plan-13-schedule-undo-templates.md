# 子项目 13 — 定时/撤销发送 + 模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 webmail 补齐「定时发送 + 撤销发送（延迟窗口）+ 邮件模板（变量替换）+ 退信/失败状态机」，全部邮件发送统一过 `outbox` 表，到点由 scheduler worker 经 MailSender 按 accountId 发出，失败指数退避重试，退信可解析可见可重试。

**Architecture:** 方案 B（详见 spec §0/子项目 13/NFR 时区·可靠性/风险登记册"发送失败/退信"）。本地单机、单进程、单 SQLite(WAL)、单用户。所有外发邮件**先入 outbox 再发**——这是定时发送与撤销发送能共用一套机制的根基：

1. **outbox 表 + 状态机**：`outbox(id, account_id, to, cc, bcc, subject, body_html, scheduled_at, status, attempts, error)`。状态机 `queued → sending → sent`（成功）/`queued → sending → failed`（重试耗尽）/`queued → sending → bounced`（退信）。状态流转集中在纯函数 `transitionOutboxStatus()`，所有写状态走它（可单测）。
2. **定时发送 worker**：scheduler（复用 `node-cron`）每分钟跑一次 `processOutbox()`：SELECT `status='queued' AND scheduled_at <= now()`（**scheduled_at 存 UTC epoch**）→ 逐条 `queued→sending` → 取账号 sender（`getSenderForAccount(accountId)`，plan-02 的 MailSender 按 accountId）→ 发送成功 `→sent`；失败按 `attempts` 指数退避（`scheduled_at = now + backoff`，状态回 `queued` 待下次重试）；达到 `MAX_OUTBOX_ATTEMPTS=5` 转 `failed`。
3. **撤销发送 = 延迟窗口**：点「发送」时不立即发，而是写 outbox 且 `scheduled_at = now + undoWindow`（窗口 5/10/20/30s 可配，settings key `outbox.undoWindowSeconds`）。窗口内 UI 显示「已暂存,将在 Xs 后发送 · 撤销」倒计时；用户点撤销 → `DELETE FROM outbox WHERE id=? AND status='queued'`（仅 queued 可撤销，sending/sent 不可）。窗口过 worker 自然到点发。**个人邮箱无真 recall，仅延迟发信。**
4. **模板**：`templates(id, account_id, name, body_html, variables[JSON])`。撰写时下拉选模板插入正文，变量占位 `{{name}}` 用 `applyTemplate(html, vars)` 纯函数替换。

**时区铁律：** `scheduled_at` 一律存 **UTC epoch（毫秒）**，DB 不存本地时间。API 接收/返回时由 `toLocalDisplay()` / `parseLocalToUtc()` 转换（基于浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 或 settings `display.timezone`），UI 全程本地时区显示，worker 比较全程 UTC。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / node-cron / nodemailer / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 1（drizzle 迁移框架 + align-baseline）、子项目 2（`accounts` 表 + `getSenderForAccount(accountId)` 返回按账号配置的 MailSender；当前 `MailSender` 已支持注入 `{host,port,user,authCode}`，plan-02 补「按 accountId 从 accounts 表读 SMTP 配置构造 MailSender」）、子项目 5（compose/ComposeMail 流程、to/cc/bcc/草稿）。若 plan-02 未就绪，本计划先以 `new MailSender()`（env 单账号）跑通，并在 sender 工厂层留 `accountId` 参数占位（plan-02 落地后填实现）。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。route handler 测试对 sender 用 `vi.mock('@/lib/adapter/mail/sender')` 或 `vi.mock('@/lib/outbox/worker')` 注入桩（不真实联网发信），对 `getDb()` 注入内存库（参考 plan-08/11/12 的 `memDb` helper 约定；若 helper 尚未存在则本计划 Task 1 先建）。

---

## 文件结构

- Create: `drizzle/000X_outbox_templates.sql` — 迁移：建 `outbox`/`templates` 表 + 索引（Task 1；编号接 plan-01 末尾，执行时对齐实际最大编号）
- Modify: `src/lib/db/schema.ts` — 追加 `outbox`/`templates` Drizzle 表定义（Task 1）
- Create: `src/lib/outbox/status.ts` — `OutboxStatus` 类型 + `transitionOutboxStatus()` 纯函数状态机 + 退避 `nextAttemptAt()`（Task 2）
- Create: `src/lib/outbox/time.ts` — `nowUtcMs()` / `parseLocalToUtc(localIsoOrMs)` / `toLocalDisplay(utcMs, tz?)` 时区纯函数（Task 3）
- Create: `src/lib/outbox/worker.ts` — `processOutbox()`：扫到点 queued → sending → 发送 → sent/failed/重试；`getSenderForAccount(accountId)` 工厂（Task 5）
- Create: `src/lib/templates/render.ts` — `applyTemplate(html, vars)` 变量替换纯函数 + `extractVariables(html)` 抽占位（Task 6）
- Create: `src/app/api/outbox/route.ts` — GET 列表 / POST 新建（入队，含 undoWindow 计算 scheduled_at）（Task 4 + 7）
- Create: `src/app/api/outbox/[id]/route.ts` — DELETE 撤销（仅 queued）/ GET 单条（Task 8）
- Create: `src/app/api/outbox/[id]/retry/route.ts` — POST 手动重试 failed/bounced（Task 8）
- Create: `src/app/api/templates/route.ts` — GET 列表 / POST 新建 / DELETE（Task 9）
- Modify: `src/lib/scheduler/index.ts` — 注册 outbox worker（每分钟 `processOutbox()`）（Task 5 Step 4）
- Modify: `src/components/ComposeMail.tsx` — 发送流程改「入 outbox + 撤销窗口倒计时 UI」+ 模板插入下拉（Task 10）
- Create: `src/components/UndoSendBar.tsx` — 撤销发送浮层（倒计时 + 撤销按钮）（Task 10）
- Create: `src/app/outbox/page.tsx`（可选）— outbox 列表（定时中/失败/退信可见可重试）（Task 10 Step 4）
- Create: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 建全列表（todos/messages/settings/**outbox/templates**）；若 plan-08/11/12 已建则复用并补两表，不重复建
- Test: `src/__tests__/outbox/status.test.ts`、`src/__tests__/outbox/time.test.ts`、`src/__tests__/outbox/worker.test.ts`、`src/__tests__/templates/render.test.ts`、`src/__tests__/api/outbox.test.ts`、`src/__tests__/api/outbox-cancel.test.ts`、`src/__tests__/api/outbox-retry.test.ts`、`src/__tests__/api/templates.test.ts`

---

## 任务

### Task 1: outbox / templates 表（迁移 + schema + memDb helper）

**Files:**
- Create: `drizzle/000X_outbox_templates.sql`
- Modify: `src/lib/db/schema.ts`
- Create: `src/__tests__/helpers/memDb.ts`

**关键设计：**
- **outbox 表 DDL**（spec §1 line 52）：
  ```sql
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,                       -- 关联 accounts(plan-02);nullable 兼容单账号 env
    to TEXT NOT NULL,                         -- 逗号分隔多收件人(与现状 messages.recipient 一致)
    cc TEXT,
    bcc TEXT,
    subject TEXT,
    body_html TEXT,
    scheduled_at INTEGER NOT NULL,            -- UTC epoch ms
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK(status IN ('queued','sending','sent','failed','bounced')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_scheduled ON outbox(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_outbox_account ON outbox(account_id);
  ```
- **templates 表 DDL**（spec §1 line 50）：
  ```sql
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,                       -- nullable:NULL=全账号通用
    name TEXT NOT NULL,
    body_html TEXT NOT NULL,
    variables TEXT,                           -- JSON 数组 ["name","dueDate"] 仅作文档/校验
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
  );
  ```
- Drizzle schema 追加两张表（`integer('scheduled_at')` 存毫秒 epoch；`text('status')` 带 enum；`text('variables')` 存 JSON 字符串）。
- **memDb helper**：内存 `better-sqlite3`（`:memory:`）→ 执行所有表（todos/messages/settings/outbox/templates）CREATE → 返回 `drizzle(sqlite, { schema })` 实例。供所有 API/worker 测试注入。

- [ ] **Step 1: 写 memDb helper（先建，后续任务都依赖）**

```ts
// src/__tests__/helpers/memDb.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

/** 内存 SQLite + 全表建表,供 API/worker 测试注入 getDb()。 */
export function memDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, due_date TEXT,
      priority TEXT, context TEXT, status TEXT NOT NULL DEFAULT 'pending',
      source_message_id TEXT, source_subject TEXT, source_from TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, subject TEXT,
      sender TEXT, recipient TEXT, body TEXT, body_html TEXT,
      received_at INTEGER, processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      direction TEXT NOT NULL DEFAULT 'in', is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
      todo_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER,
      to TEXT NOT NULL, cc TEXT, bcc TEXT, subject TEXT, body_html TEXT,
      scheduled_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_scheduled ON outbox(status, scheduled_at);
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER,
      name TEXT NOT NULL, body_html TEXT NOT NULL, variables TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );
  `)
  return drizzle(sqlite, { schema })
}
```

> 注：`memDb` 返回 drizzle 实例；若某测试需要裸 better-sqlite3（如直接 `db.exec` 写 settings），则在该测试内 `const raw = (db as any).__` —— drizzle better-sqlite3 实例的底层 handler 不可直接拿，故 memDb 额外 `return { db: drizzle, raw: sqlite }`，下游测试用 `const { db, raw } = memDb()`。**实现时统一返回 `{ db, raw }`**，注入 `getDb` 时传 `db`。

- [ ] **Step 2: schema.ts 追加两张表**

```ts
// src/lib/db/schema.ts —— 追加
export const outbox = sqliteTable('outbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id'),
  to: text('to').notNull(),
  cc: text('cc'),
  bcc: text('bcc'),
  subject: text('subject'),
  bodyHtml: text('body_html'),
  scheduledAt: integer('scheduled_at').notNull(),          // UTC ms epoch
  status: text('status', { enum: ['queued', 'sending', 'sent', 'failed', 'bounced'] }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  sentAt: integer('sent_at'),
})

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id'),                         // null=全账号通用
  name: text('name').notNull(),
  bodyHtml: text('body_html').notNull(),
  variables: text('variables'),                             // JSON 字符串
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
})
```

- [ ] **Step 3: 写迁移 SQL** `drizzle/000X_outbox_templates.sql`（编号执行时对齐 plan-01 末尾最大编号 +1）：内容即上方两段 DDL（含索引）。`drizzle-kit generate` 生成或手写均可，手写后需 plan-01 的 `migrate()` 读取 `drizzle/*.sql` 执行。

- [ ] **Step 4: 验证**：`npx tsc --noEmit` → 无类型错误。手跑（若 plan-01 迁移就绪）`npm run db:migrate` 确认表建出。写最小冒烟测试 `src/__tests__/db/memdb-smoke.test.ts`：`const { raw } = memDb(); expect(raw.prepare("SELECT count(*) c FROM outbox").get()).toBeTruthy()`。

- [ ] **Step 5: Commit**

```bash
git add drizzle/000X_outbox_templates.sql src/lib/db/schema.ts src/__tests__/helpers/memDb.ts src/__tests__/db/memdb-smoke.test.ts
git commit -m "feat(db): outbox + templates tables, migration, memDb test helper"
git push
```

---

### Task 2: outbox 状态机纯函数（transitionOutboxStatus + 退避）

**Files:**
- Create: `src/lib/outbox/status.ts`
- Create: `src/__tests__/outbox/status.test.ts`

**关键设计：** 状态流转全部走 `transitionOutboxStatus(current, event)` 纯函数，返回 `{ status, ...patch }`，非法流转抛错。事件 `send_started` / `send_succeeded` / `send_failed` / `bounced` / `retry_scheduled`。退避用 `nextAttemptAt(attempts, nowUtcMs)` 纯函数：指数退避 `2^attempts * BASE_DELAY`（BASE=30s），封顶 `MAX_BACKOFF_MS=30min`；`attempts >= MAX_OUTBOX_ATTEMPTS(5)` 时不再退避，状态转 `failed`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import {
  transitionOutboxStatus, nextAttemptAt,
  MAX_OUTBOX_ATTEMPTS, BASE_BACKOFF_MS, MAX_BACKOFF_MS,
} from '@/lib/outbox/status'

describe('transitionOutboxStatus — 状态机流转', () => {
  it('queued + send_started → sending', () => {
    expect(transitionOutboxStatus('queued', 'send_started')).toBe('sending')
  })
  it('sending + send_succeeded → sent', () => {
    expect(transitionOutboxStatus('sending', 'send_succeeded')).toBe('sent')
  })
  it('sending + send_failed → 失败但 attempts 未满仍 queued(待重试) 或 failed(满)', () => {
    // send_failed 需 attempts 上下文:用带参重载
    expect(transitionOutboxStatus('sending', 'send_failed', { attempts: 1, maxAttempts: 5 })).toBe('queued')
    expect(transitionOutboxStatus('sending', 'send_failed', { attempts: 5, maxAttempts: 5 })).toBe('failed')
  })
  it('sending + bounced → bounced', () => {
    expect(transitionOutboxStatus('sending', 'bounced')).toBe('bounced')
  })
  it('非法流转抛错(sending + send_started)', () => {
    expect(() => transitionOutboxStatus('sending', 'send_started')).toThrow(/invalid/i)
  })
  it('终态 sent/failed/bounced 不再流转', () => {
    expect(() => transitionOutboxStatus('sent', 'send_started')).toThrow(/invalid/i)
    expect(() => transitionOutboxStatus('failed', 'send_succeeded')).toThrow(/invalid/i)
  })
})

describe('nextAttemptAt — 指数退避', () => {
  const now = 1_700_000_000_000
  it('第1次失败 → +30s', () => {
    expect(nextAttemptAt(1, now) - now).toBe(30_000)
  })
  it('指数增长 2^(n-1)', () => {
    expect(nextAttemptAt(2, now) - now).toBe(60_000)
    expect(nextAttemptAt(3, now) - now).toBe(120_000)
  })
  it('封顶 30min', () => {
    expect(nextAttemptAt(10, now) - now).toBe(MAX_BACKOFF_MS)
  })
  it('MAX_OUTBOX_ATTEMPTS=5', () => { expect(MAX_OUTBOX_ATTEMPTS).toBe(5) })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/outbox/status.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/lib/outbox/status.ts
export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced'
export type OutboxEvent =
  | 'send_started' | 'send_succeeded' | 'send_failed' | 'bounced'

export const MAX_OUTBOX_ATTEMPTS = 5
export const BASE_BACKOFF_MS = 30_000        // 30s
export const MAX_BACKOFF_MS = 30 * 60_000    // 30min

export interface FailContext {
  attempts: number          // 当前已尝试次数(失败前的累计)
  maxAttempts?: number
}

/**
 * outbox 状态机(纯函数)。所有状态写都走它。
 * - queued + send_started → sending
 * - sending + send_succeeded → sent
 * - sending + send_failed → attempts 未满 queued(待重试),满 failed
 * - sending + bounced → bounced
 * 其余非法流转抛错(防止终态再发、防止乱跳)。
 */
export function transitionOutboxStatus(
  current: OutboxStatus,
  event: OutboxEvent,
  failCtx?: FailContext,
): OutboxStatus {
  const max = failCtx?.maxAttempts ?? MAX_OUTBOX_ATTEMPTS
  switch (event) {
    case 'send_started':
      if (current !== 'queued') throw new Error(`invalid transition: ${current} + send_started`)
      return 'sending'
    case 'send_succeeded':
      if (current !== 'sending') throw new Error(`invalid transition: ${current} + send_succeeded`)
      return 'sent'
    case 'send_failed': {
      if (current !== 'sending') throw new Error(`invalid transition: ${current} + send_failed`)
      const attempts = failCtx?.attempts ?? 0
      return attempts >= max ? 'failed' : 'queued'   // 未满 → 回 queued 等退避后重试
    }
    case 'bounced':
      if (current !== 'sending') throw new Error(`invalid transition: ${current} + bounced`)
      return 'bounced'
    default:
      throw new Error(`unknown event: ${event as string}`)
  }
}

/** 指数退避:第 attempts 次失败后,下次可重试时刻(UTC ms)。delay = min(2^(attempts-1)*BASE, MAX)。 */
export function nextAttemptAt(attempts: number, nowUtcMs: number): number {
  const delay = Math.min(Math.pow(2, attempts - 1) * BASE_BACKOFF_MS, MAX_BACKOFF_MS)
  return nowUtcMs + delay
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbox/status.ts src/__tests__/outbox/status.test.ts
git commit -m "feat(outbox): status state-machine + exponential backoff pure fns"
git push
```

---

### Task 3: 时区纯函数（UTC 存 / 本地显）

**Files:**
- Create: `src/lib/outbox/time.ts`
- Create: `src/__tests__/outbox/time.test.ts`

**关键设计：** `nowUtcMs()` = `Date.now()`（存库）。`parseLocalToUtc(input, tz?)`：输入是「本地时区的 wall-clock」描述（`{date:'2026-06-18', time:'09:30'}` 或 ISO `2026-06-18T09:30`），用 `luxon`-free 纯 `Date` + 显式偏移换算——更稳妥做法是用 `Intl` 构造带 tz 的时间再取 epoch。**本地单机单用户**：默认 tz 取 `Intl.DateTimeFormat().resolvedOptions().timeZone`（浏览器侧）/settings `display.timezone`（服务侧 worker 无 tz 概念，只比 epoch）。`toLocalDisplay(utcMs, tz?)`：epoch → `{date, time, label}`（如 `2026-06-18 09:30`）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { nowUtcMs, toLocalDisplay, parseLocalToUtc } from '@/lib/outbox/time'

describe('nowUtcMs', () => {
  it('返回当前 epoch 毫秒', () => {
    const before = Date.now()
    const v = nowUtcMs()
    const after = Date.now()
    expect(v).toBeGreaterThanOrEqual(before)
    expect(v).toBeLessThanOrEqual(after)
  })
})

describe('toLocalDisplay', () => {
  it('UTC ms → 指定 tz 的 wall-clock', () => {
    // 2026-06-18T01:00:00Z 在 Asia/Shanghai(+08) = 09:00
    const ms = Date.UTC(2026, 5, 18, 1, 0, 0)
    const d = toLocalDisplay(ms, 'Asia/Shanghai')
    expect(d.time).toBe('09:00')
    expect(d.date).toBe('2026-06-18')
  })
  it('跨天正确(UTC 23:00 在 +08 = 次日 07:00)', () => {
    const ms = Date.UTC(2026, 5, 18, 23, 0, 0)
    const d = toLocalDisplay(ms, 'Asia/Shanghai')
    expect(d.date).toBe('2026-06-19')
    expect(d.time).toBe('07:00')
  })
})

describe('parseLocalToUtc', () => {
  it('本地 wall-clock → UTC ms', () => {
    // 上海 09:30 = UTC 01:30
    const ms = parseLocalToUtc({ date: '2026-06-18', time: '09:30' }, 'Asia/Shanghai')
    expect(new Date(ms).toISOString()).toBe('2026-06-18T01:30:00.000Z')
  })
  it('默认 tz = 系统本地', () => {
    expect(() => parseLocalToUtc({ date: '2026-06-18', time: '09:30' })).not.toThrow()
  })
  it('非法输入抛错', () => {
    expect(() => parseLocalToUtc({ date: 'bad', time: '09:30' }, 'Asia/Shanghai')).toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**（不引入 luxon，用 `Intl.DateTimeFormat` en-US + timeZone 反解出 wall-clock parts；parse 用「在目标 tz 把 wall-clock 当本地构造」技巧——构造一个临时 Date 在目标 tz 下落到指定时分）。

```ts
// src/lib/outbox/time.ts
export function nowUtcMs(): number { return Date.now() }

export function systemTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** UTC ms → 指定 tz 的 {date, time, label} wall-clock(仅显示用)。 */
export function toLocalDisplay(
  utcMs: number,
  tz: string = systemTimezone(),
): { date: string; time: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const time = `${get('hour')}:${get('minute')}`
  return { date, time, label: `${date} ${time}` }
}

/** 本地 wall-clock {date,time} → UTC ms。把指定 tz 的 wall-clock 当作该 tz 的本地时间换算 epoch。 */
export function parseLocalToUtc(
  input: { date: string; time: string },
  tz: string = systemTimezone(),
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date)
  if (!m) throw new Error(`invalid date: ${input.date} (expect YYYY-MM-DD)`)
  const tm = /^(\d{2}):(\d{2})$/.exec(input.time)
  if (!tm) throw new Error(`invalid time: ${input.time} (expect HH:MM)`)
  const [, y, mo, d] = m; const [, h, mi] = tm
  // 把 wall-clock 当 UTC 构造,再按 tz 偏移修正
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, 0)
  // 计算 tz 在该 UTC 时刻的偏移(分钟)
  const offsetMin = tzOffsetMinutes(asUtc, tz)
  return asUtc - offsetMin * 60_000
}

function tzOffsetMinutes(utcMs: number, tz: string): number {
  // 目标 tz 的 wall-clock epoch(把 tz 当本地)
  const tzWall = new Date(utcMs).toLocaleString('en-US', { timeZone: tz })
  const tzAsEpoch = Date.parse(tzWall)        // 解析为本地(测试机)ms
  const utcWall = new Date(utcMs).toLocaleString('en-US', { timeZone: 'UTC' })
  const utcAsEpoch = Date.parse(utcWall)
  return Math.round((tzAsEpoch - utcAsEpoch) / 60_000)
}
```

- [ ] **Step 4: 运行确认通过** → PASS（若 `tzOffsetMinutes` 在测试机非 UTC 时区有符号问题，以测试断言为准微调；核心是上海 09:30 → `2026-06-18T01:30:00Z`）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbox/time.ts src/__tests__/outbox/time.test.ts
git commit -m "feat(outbox): timezone pure fns (UTC store / local display / local-to-UTC parse)"
git push
```

---

### Task 4: 模板渲染纯函数（applyTemplate + extractVariables）

**Files:**
- Create: `src/lib/templates/render.ts`
- Create: `src/__tests__/templates/render.test.ts`

**关键设计：** `applyTemplate(html, vars)`：把 `{{name}}`（变量名 `[A-Za-z_][\w]*`）替换为 `vars[name]`；未提供的变量保留占位或替换为空（默认留空，便于用户再填）。`extractVariables(html)`：正则抽所有 `{{x}}` 去重，返回变量名数组（供 UI 列出待填项 + 写 templates.variables 校验）。HTML 注释里的 `{{x}}` 不替换（避免碰模板注释语法）——简版：只处理文本节点级别的占位即可，初版全量替换足够。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { applyTemplate, extractVariables } from '@/lib/templates/render'

describe('applyTemplate', () => {
  it('替换单个变量', () => {
    expect(applyTemplate('你好 {{name}}', { name: '张三' })).toBe('你好 张三')
  })
  it('替换多个不同变量', () => {
    expect(applyTemplate('{{greeting}}, {{name}}', { greeting: 'Hi', name: '李四' })).toBe('Hi, 李四')
  })
  it('未提供变量 → 留空', () => {
    expect(applyTemplate('你好 {{name}}', {})).toBe('你好 ')
  })
  it('变量名含下划线/数字', () => {
    expect(applyTemplate('{{due_date}} / {{item1}}', { due_date: '06-18', item1: 'X' })).toBe('06-18 / X')
  })
  it('同名变量多处都替换', () => {
    expect(applyTemplate('{{name}}-{{name}}', { name: 'A' })).toBe('A-A')
  })
  it('保留 HTML 结构', () => {
    expect(applyTemplate('<p>{{x}}</p>', { x: '<b>' })).toBe('<p><b></p>')
  })
})

describe('extractVariables', () => {
  it('抽出变量名去重', () => {
    expect(extractVariables('{{name}} 和 {{name}} 与 {{date}}')).toEqual(['name', 'date'])
  })
  it('无变量 → 空数组', () => {
    expect(extractVariables('普通文本')).toEqual([])
  })
  it('排序稳定', () => {
    expect(extractVariables('{{z}} {{a}} {{m}}')).toEqual(['z', 'a', 'm'])
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/templates/render.ts
const VAR_RE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g

/** 替换 {{name}} 占位。未提供的变量替换为空串。 */
export function applyTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(VAR_RE, (full, name: string) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : ''
  })
}

/** 抽取所有 {{name}} 占位的变量名(按出现顺序去重)。 */
export function extractVariables(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  VAR_RE.lastIndex = 0
  while ((m = VAR_RE.exec(html)) !== null) {
    const name = m[1]
    if (!seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/render.ts src/__tests__/templates/render.test.ts
git commit -m "feat(templates): applyTemplate + extractVariables pure fns ({{var}} replacement)"
git push
```

---

### Task 5: outbox worker（processOutbox 定时发送 + 重试 + getSenderForAccount）

**Files:**
- Create: `src/lib/outbox/worker.ts`
- Create: `src/__tests__/outbox/worker.test.ts`
- Modify: `src/lib/scheduler/index.ts`

**关键设计：**
- `getSenderForAccount(accountId?)`：读 `accounts` 表（plan-02）取 `smtp_host/smtp_port/user/auth_code` 构造 `MailSender`；`accountId` 为 null/undefined 且 accounts 表不存在 → 回落 `new MailSender()`（env 单账号，当前行为）。**plan-02 未就绪时本函数只做 env 回落 + 留 TODO**，签名稳定。
- `processOutbox(opts?)`：注入 `db`/`now`/`senderFactory` 供单测。
  1. `SELECT * FROM outbox WHERE status='queued' AND scheduled_at <= :now ORDER BY scheduled_at`。
  2. 逐条：`attempts += 1` → `queued→sending`（transitionOutboxStatus）→ `sender.send({to,cc,bcc,subject,html})`。
  3. 成功：`→sent`，写 `sent_at`，并把已发邮件落 messages 表（direction='out'，复用现状 `/api/send` 落库逻辑）。
  4. 失败：判退信（错误信息含 `bounced`/`rejected`/`User unknown`/`550` → 事件 `bounced`；否则 `send_failed`）。`send_failed` 且 attempts 未满 → 状态回 `queued`、`scheduled_at = nextAttemptAt(attempts, now)`、写 `error`；attempts 满 → `failed`。`bounced` → `bounced`（不重试，需人工）。
  5. 返回 `{ processed, sent, retried, failed, bounced }`。
- 退信判定纯函数 `classifyFailure(errMsg): 'bounced' | 'transient'`（可单测）。
- scheduler 注册：`startScheduler` 内每分钟 `await processOutbox()`（独立于每 30 分钟拉取，加第二个 cron `* * * * *`）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processOutbox, classifyFailure, getSenderForAccount } from '@/lib/outbox/worker'
import { memDb } from '../helpers/memDb'

const mkSender = (ok: boolean, err?: any) => ({
  send: ok ? vi.fn().mockResolvedValue({ messageId: '<sent-1@x>' })
           : vi.fn().mockRejectedValue(err ?? new Error('boom')),
})

describe('classifyFailure', () => {
  it('550/User unknown → bounced', () => {
    expect(classifyFailure('550 User unknown')).toBe('bounced')
    expect(classifyFailure('recipient rejected')).toBe('bounced')
  })
  it('网络/超时 → transient', () => {
    expect(classifyFailure('connect ETIMEDOUT')).toBe('transient')
    expect(classifyFailure('boom')).toBe('transient')
  })
})

describe('processOutbox', () => {
  it('到点的 queued → 发送成功 → sent + 落 messages', async () => {
    const { db, raw } = memDb()
    const now = Date.now()
    raw.prepare("INSERT INTO outbox (to,subject,body_html,scheduled_at,status,attempts) VALUES (?,?,?,?,?,0)")
      .run('a@b.com', 'S', '<p>hi</p>', now - 1000, 'queued')
    const r = await processOutbox({ db, now, senderFactory: () => mkSender(true) as any })
    expect(r.sent).toBe(1)
    const row = raw.prepare("SELECT status, sent_at FROM outbox WHERE id=1").get() as any
    expect(row.status).toBe('sent')
    expect(row.sent_at).toBeGreaterThan(0)
    expect((raw.prepare("SELECT count(*) c FROM messages WHERE direction='out'").get() as any).c).toBe(1)
  })
  it('未到点的不发', async () => {
    const { db, raw } = memDb()
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?, 'queued')").run(Date.now() + 60000)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(true) as any })
    expect(r.sent).toBe(0)
    expect((raw.prepare("SELECT status FROM outbox WHERE id=1").get() as any).status).toBe('queued')
  })
  it('瞬态失败 + attempts 未满 → 回 queued + 退避 scheduled_at 后移', async () => {
    const { db, raw } = memDb()
    const now = Date.now()
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status,attempts) VALUES ('a@b',?,'queued',0)").run(now - 1)
    const r = await processOutbox({ db, now, senderFactory: () => mkSender(false, new Error('ETIMEDOUT')) as any })
    expect(r.retried).toBe(1)
    const row = raw.prepare("SELECT status, attempts, scheduled_at, error FROM outbox WHERE id=1").get() as any
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(1)
    expect(row.scheduled_at).toBeGreaterThan(now)        // 后移了
    expect(row.error).toMatch(/ETIMEDOUT/)
  })
  it('退信 → bounced 不重试', async () => {
    const { db, raw } = memDb()
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'queued')").run(Date.now() - 1)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(false, new Error('550 User unknown')) as any })
    expect(r.bounced).toBe(1)
    expect((raw.prepare("SELECT status FROM outbox WHERE id=1").get() as any).status).toBe('bounced')
  })
  it('attempts 达上限 → failed', async () => {
    const { db, raw } = memDb()
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status,attempts) VALUES ('a@b',?,'queued',5)").run(Date.now() - 1)
    const r = await processOutbox({ db, now: Date.now(), senderFactory: () => mkSender(false) as any })
    expect(r.failed).toBe(1)
    expect((raw.prepare("SELECT status FROM outbox WHERE id=1").get() as any).status).toBe('failed')
  })
})

describe('getSenderForAccount', () => {
  it('accounts 表不存在/未就绪 → 回落 env MailSender(plan-02 前)', () => {
    const { db } = memDb()        // memDb 无 accounts 表
    const s = getSenderForAccount(undefined, db)
    expect(s).toBeDefined()
    expect(typeof s.send).toBe('function')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/outbox/worker.ts`**

```ts
// src/lib/outbox/worker.ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { MailSender } from '@/lib/adapter/mail/sender'
import { transitionOutboxStatus, nextAttemptAt, MAX_OUTBOX_ATTEMPTS } from './status'
import { getDb } from '@/lib/db'

export interface SenderLike { send(p: { to: string; cc?: string; bcc?: string; subject?: string; html?: string; body?: string }): Promise<{ messageId: string }> }

/** 退信判定:返回 'bounced'(永久,不重试) 或 'transient'(瞬态,可重试)。 */
export function classifyFailure(errMsg: string): 'bounced' | 'transient' {
  const s = errMsg || ''
  if (/550|user unknown|recipient rejected|mailbox (is )?full|no such user|does not exist/i.test(s)) return 'bounced'
  return 'transient'
}

/**
 * 取账号对应的 MailSender。plan-02 就绪后:读 accounts 表的 smtp_host/port/user/auth_code 构造。
 * plan-02 未就绪时:accounts 表不存在 → 回落 new MailSender()(env 单账号)。签名稳定。
 */
export function getSenderForAccount(accountId: number | null | undefined, db?: any): SenderLike {
  // plan-02 占位:尝试读 accounts,失败则 env 回落
  try {
    if (accountId != null && db) {
      // @ts-ignore —— accounts 表由 plan-02 引入;运行时 try/catch 保护
      const row = db.prepare('SELECT smtp_host, smtp_port, user, auth_code FROM accounts WHERE id=?').get(accountId)
      if (row) {
        return new MailSender({ host: row.smtp_host, port: row.smtp_port, user: row.user, authCode: row.auth_code })
      }
    }
  } catch { /* accounts 表未就绪 → env 回落 */ }
  return new MailSender()
}

export interface ProcessOutboxOpts {
  db?: any
  now?: number
  senderFactory?: (accountId: number | null) => SenderLike
}

export interface ProcessResult { processed: number; sent: number; retried: number; failed: number; bounced: number }

/**
 * 扫描到点的 queued 邮件发送。状态全程走 transitionOutboxStatus。
 * 注入 db/now/senderFactory 供单测;默认用 getDb()/Date.now()/getSenderForAccount。
 */
export async function processOutbox(opts: ProcessOutboxOpts = {}): Promise<ProcessResult> {
  const db = opts.db ?? getDb()
  const now = opts.now ?? Date.now()
  const factory = opts.senderFactory ?? ((acct) => getSenderForAccount(acct, db))
  const result: ProcessResult = { processed: 0, sent: 0, retried: 0, failed: 0, bounced: 0 }

  const pending = db.prepare(
    "SELECT * FROM outbox WHERE status='queued' AND scheduled_at <= ? ORDER BY scheduled_at ASC"
  ).all(now) as Array<any>

  for (const row of pending) {
    result.processed++
    const attempts = row.attempts + 1
    // queued → sending
    db.prepare("UPDATE outbox SET status='sending', attempts=? WHERE id=?").run(attempts, row.id)
    const sender = factory(row.account_id ?? null)
    try {
      const r = await sender.send({
        to: row.to, cc: row.cc || undefined, bcc: row.bcc || undefined,
        subject: row.subject || undefined, html: row.body_html || undefined, body: row.body_html || '',
      })
      const st = transitionOutboxStatus('sending', 'send_succeeded')
      db.prepare("UPDATE outbox SET status=?, sent_at=?, error=NULL WHERE id=?").run(st, Date.now(), row.id)
      // 落 messages(direction=out)
      db.prepare(
        "INSERT INTO messages (message_id, subject, sender, recipient, body, body_html, direction, is_read) VALUES (?,?,?,?,?,?,?,1)"
      ).run(r.messageId || `sent-${row.id}-${Date.now()}`, row.subject, row.from_addr || null, row.to, row.body_html || '', row.body_html || null, 'out')
      result.sent++
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      const kind = classifyFailure(errMsg)
      if (kind === 'bounced') {
        const st = transitionOutboxStatus('sending', 'bounced')
        db.prepare("UPDATE outbox SET status=?, error=? WHERE id=?").run(st, errMsg, row.id)
        result.bounced++
      } else {
        const st = transitionOutboxStatus('sending', 'send_failed', { attempts, maxAttempts: MAX_OUTBOX_ATTEMPTS })
        if (st === 'failed') {
          db.prepare("UPDATE outbox SET status=?, error=? WHERE id=?").run(st, errMsg, row.id)
          result.failed++
        } else {
          const next = nextAttemptAt(attempts, now)
          db.prepare("UPDATE outbox SET status='queued', scheduled_at=?, error=? WHERE id=?").run(next, errMsg, row.id)
          result.retried++
        }
      }
    }
  }
  return result
}
```

- [ ] **Step 4: scheduler 注册**：`src/lib/scheduler/index.ts` 在 `startScheduler` 末尾增加每分钟 outbox worker：
  ```ts
  // 每 30 分钟拉取(现有) ... 之外,增加:
  import { processOutbox } from '@/lib/outbox/worker'
  let outboxTask: ReturnType<typeof cron.schedule> | null = null
  // startScheduler 内:
  outboxTask = cron.schedule('* * * * *', async () => {
    try { await processOutbox() } catch (e) { console.error('[Scheduler] outbox process failed', e) }
  })
  // stopScheduler 内:outboxTask?.stop(); outboxTask = null
  ```
  （保持 startScheduler 入参不变，仅内部多一个定时器。）

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: 回归** `npx vitest run src/__tests__/outbox/ src/__tests__/templates/` → 全绿。`npx tsc --noEmit` → 无错误。

- [ ] **Step 7: Commit**

```bash
git add src/lib/outbox/worker.ts src/__tests__/outbox/worker.test.ts src/lib/scheduler/index.ts
git commit -m "feat(outbox): processOutbox worker (cron-driven send, exponential retry, bounce classification)"
git push
```

---

### Task 6: 模板 CRUD API（/api/templates）

**Files:**
- Create: `src/app/api/templates/route.ts`
- Create: `src/__tests__/api/templates.test.ts`

**关键设计：** `GET /api/templates?accountId=X`：列模板（accountId 匹配或 account_id IS NULL 通用）。`POST /api/templates`：body `{ name, bodyHtml, accountId?, variables? }` → 校验 name/bodyHtml 非空 → 若未传 variables 则用 `extractVariables(bodyHtml)` 自动抽 → 写库 → 返回。`DELETE /api/templates?id=X`。variables 字段存 JSON 字符串。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET, POST, DELETE } from '@/app/api/templates/route'
import { memDb } from '../helpers/memDb'

describe('/api/templates', () => {
  beforeEach(() => { const { db, raw } = memDb(); (require('@/lib/db') as any).__setDb(db); (globalThis as any).__raw = raw })

  it('POST 建模板 + 自动抽 variables', async () => {
    const res = await POST(new Request('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '问候', bodyHtml: '你好 {{name}}' }) }))
    expect(res.status).toBe(201)
    const raw = (globalThis as any).__raw
    const row = raw.prepare('SELECT name, variables FROM templates WHERE id=1').get()
    expect(row.name).toBe('问候')
    expect(JSON.parse(row.variables)).toEqual(['name'])
  })
  it('POST 缺 name → 400', async () => {
    const res = await POST(new Request('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bodyHtml: 'x' }) }))
    expect(res.status).toBe(400)
  })
  it('GET 列出', async () => {
    await POST(new Request('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'T', bodyHtml: 'hi {{x}}' }) }))
    const j = await (await GET()).json()
    expect(j.templates).toHaveLength(1)
    expect(j.templates[0].name).toBe('T')
  })
  it('DELETE by id', async () => {
    await POST(new Request('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'T', bodyHtml: 'x' }) }))
    const raw = (globalThis as any).__raw
    await DELETE(new Request('http://x/api/templates?id=1', { method: 'DELETE' }))
    expect(raw.prepare('SELECT count(*) c FROM templates').get().c).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/app/api/templates/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { extractVariables } from '@/lib/templates/render'

export async function GET(req: NextRequest) {
  const db = getDb()
  const acct = req.nextUrl.searchParams.get('accountId')
  const rows = acct
    ? (db as any).prepare('SELECT * FROM templates WHERE account_id=? OR account_id IS NULL ORDER BY name').all(Number(acct))
    : (db as any).prepare('SELECT * FROM templates ORDER BY name').all()
  const templates = rows.map((r: any) => ({ ...r, variables: r.variables ? JSON.parse(r.variables) : [] }))
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name || !body.bodyHtml) {
    return NextResponse.json({ error: 'Missing name or bodyHtml' }, { status: 400 })
  }
  const variables = Array.isArray(body.variables) && body.variables.length > 0
    ? body.variables
    : extractVariables(body.bodyHtml)
  const db = getDb()
  const res = (db as any).prepare(
    'INSERT INTO templates (account_id, name, body_html, variables) VALUES (?,?,?,?)'
  ).run(body.accountId ?? null, body.name, body.bodyHtml, JSON.stringify(variables))
  const row = (db as any).prepare('SELECT * FROM templates WHERE id=?').get(res.lastInsertRowid)
  return NextResponse.json({ template: { ...row, variables } }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  getDb().prepare('DELETE FROM templates WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/templates/route.ts src/__tests__/api/templates.test.ts
git commit -m "feat(api): templates CRUD with auto variable extraction"
git push
```

---

### Task 7: outbox 入队 API（/api/outbox POST 新建 + undoWindow 计算）

**Files:**
- Create: `src/app/api/outbox/route.ts`（GET 列表 + POST 入队）
- Create: `src/__tests__/api/outbox.test.ts`

**关键设计：**
- `GET /api/outbox?status=queued|failed|bounced`：列 outbox（默认非 sent，即可操作/可见的），UI 用。
- `POST /api/outbox`：body `{ accountId?, to, cc?, bcc?, subject, bodyHtml, scheduledAt?, sendMode }`。
  - `sendMode='undo'`（默认，立即发但有撤销窗口）：`scheduledAt = now + undoWindowSeconds`（settings key `outbox.undoWindowSeconds`，默认 10s，允许 5/10/20/30）。
  - `sendMode='schedule'`：`scheduledAt = parseLocalToUtc(body.scheduledAt)`（前端传本地 wall-clock `{date,time}` 或 ISO；存 UTC）。
  - `sendMode='now'`：`scheduledAt = now`（worker 下个 tick 即发，无撤销窗口——纯立即）。
  - 校验 `to`/`subject`/`bodyHtml` 非空；`scheduledAt` 不得早于 now（定时场景）。写库 status='queued' attempts=0。返回 `{ id, scheduledAt(UTC ms), scheduledAtLocal(显示用) }`。
- `getUndoWindowSeconds()`：读 settings，校验 ∈ {5,10,20,30}，否则默认 10。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET, POST } from '@/app/api/outbox/route'
import { memDb } from '../helpers/memDb'

describe('POST /api/outbox', () => {
  beforeEach(() => { const { db, raw } = memDb(); (require('@/lib/db') as any).__setDb(db); (globalThis as any).__raw = raw })

  it('undo 模式:scheduledAt = now + undoWindow(默认10s)', async () => {
    const before = Date.now()
    const res = await POST(new Request('http://x/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'a@b', subject: 'S', bodyHtml: '<p>x</p>', sendMode: 'undo' }) }))
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.scheduledAt).toBeGreaterThanOrEqual(before + 9000)
    expect(j.scheduledAt).toBeLessThanOrEqual(before + 11000)
    const raw = (globalThis as any).__raw
    expect((raw.prepare('SELECT status FROM outbox WHERE id=?').get(j.id) as any).status).toBe('queued')
  })
  it('undoWindow 可配(settings 20s)', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO settings (key,value) VALUES ('outbox.undoWindowSeconds','20')").run()
    const before = Date.now()
    const j = await (await POST(new Request('http://x/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'a@b', subject: 'S', bodyHtml: 'x' }) }))).json()
    expect(j.scheduledAt).toBeGreaterThanOrEqual(before + 19000)
  })
  it('schedule 模式:本地 wall-clock 转 UTC 存', async () => {
    const j = await (await POST(new Request('http://x/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'a@b', subject: 'S', bodyHtml: 'x', sendMode: 'schedule', scheduledAt: { date: '2026-12-31', time: '23:59' } }) }))).json()
    expect(typeof j.scheduledAt).toBe('number')
    // scheduledAtLocal 回填用于显示
    expect(j.scheduledAtLocal).toBeTruthy()
  })
  it('schedule 过去时间 → 400', async () => {
    const res = await POST(new Request('http://x/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'a@b', subject: 'S', bodyHtml: 'x', sendMode: 'schedule', scheduledAt: { date: '2020-01-01', time: '00:00' } }) }))
    expect(res.status).toBe(400)
  })
  it('缺 to → 400', async () => {
    const res = await POST(new Request('http://x/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'S', bodyHtml: 'x' }) }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/outbox', () => {
  it('列出非 sent', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'queued'), ('c@d',?,'sent')").run(Date.now(), Date.now())
    const j = await (await GET()).json()
    expect(j.items).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/app/api/outbox/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { parseLocalToUtc, toLocalDisplay, systemTimezone } from '@/lib/outbox/time'

const ALLOWED_UNDO = [5, 10, 20, 30]

export function getUndoWindowSeconds(db: any): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='outbox.undoWindowSeconds'").get()
    if (row) { const n = Number(row.value); if (ALLOWED_UNDO.includes(n)) return n }
  } catch { /* noop */ }
  return 10
}

export async function GET(req: NextRequest) {
  const db = getDb()
  const status = req.nextUrl.searchParams.get('status')
  const rows = status
    ? db.prepare('SELECT * FROM outbox WHERE status=? ORDER BY scheduled_at DESC').all(status)
    : db.prepare("SELECT * FROM outbox WHERE status!='sent' ORDER BY scheduled_at DESC").all()
  const items = rows.map((r: any) => ({ ...r, scheduledAtLocal: toLocalDisplay(r.scheduled_at).label }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { to, cc, bcc, subject, bodyHtml } = body
  if (!to || !subject || !bodyHtml) {
    return NextResponse.json({ error: 'Missing to, subject, or bodyHtml' }, { status: 400 })
  }
  const db = getDb()
  const now = Date.now()
  let scheduledAt: number
  const mode = body.sendMode || 'undo'
  if (mode === 'schedule') {
    scheduledAt = parseLocalToUtc(body.scheduledAt, body.timezone || systemTimezone())
    if (scheduledAt <= now) {
      return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 })
    }
  } else if (mode === 'now') {
    scheduledAt = now
  } else { // undo
    scheduledAt = now + getUndoWindowSeconds(db) * 1000
  }
  const res = db.prepare(
    'INSERT INTO outbox (account_id, to, cc, bcc, subject, body_html, scheduled_at, status, attempts) VALUES (?,?,?,?,?,?,?,\'queued\',0)'
  ).run(body.accountId ?? null, to, cc || null, bcc || null, subject, bodyHtml, scheduledAt)
  return NextResponse.json({
    id: res.lastInsertRowid,
    scheduledAt,
    scheduledAtLocal: toLocalDisplay(scheduledAt).label,
    undoWindowSeconds: mode === 'undo' ? getUndoWindowSeconds(db) : 0,
  }, { status: 201 })
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/outbox/route.ts src/__tests__/api/outbox.test.ts
git commit -m "feat(api): outbox enqueue (undo/schedule/now modes, UTC store, local display)"
git push
```

---

### Task 8: 撤销 + 重试 API（/api/outbox/[id] DELETE + /api/outbox/[id]/retry POST）

**Files:**
- Create: `src/app/api/outbox/[id]/route.ts`（GET 单条 + DELETE 撤销）
- Create: `src/app/api/outbox/[id]/retry/route.ts`（POST 手动重试）
- Create: `src/__tests__/api/outbox-cancel.test.ts`
- Create: `src/__tests__/api/outbox-retry.test.ts`

**关键设计：**
- `DELETE /api/outbox/[id]`（撤销）：仅 `status='queued'` 可删（窗口内才可撤销）。非 queued（sending/sent/failed/bounced）→ 409 Conflict + 提示「已发送/发送中,无法撤销」。删除即物理删（outbox 是临时队列，撤销=用户取消发信）。
- `POST /api/outbox/[id]/retry`（手动重试 failed/bounced）：把 status 改回 queued、attempts 重置为 0、scheduled_at = now、error=NULL，worker 下个 tick 重发。仅 failed/bounced 可重试；queued/sending → 409。

- [ ] **Step 1: 写失败测试（撤销）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { DELETE } from '@/app/api/outbox/[id]/route'
import { memDb } from '../../helpers/memDb'

describe('DELETE /api/outbox/[id] (撤销)', () => {
  beforeEach(() => { const { db, raw } = memDb(); (require('@/lib/db') as any).__setDb(db); (globalThis as any).__raw = raw })

  it('queued 可撤销(删除)', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'queued')").run(Date.now() + 5000)
    const res = await DELETE({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(200)
    expect(raw.prepare('SELECT count(*) c FROM outbox').get().c).toBe(0)
  })
  it('sent 不可撤销 → 409', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'sent')").run(Date.now())
    const res = await DELETE({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(409)
  })
  it('sending 不可撤销 → 409', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'sending')").run(Date.now())
    const res = await DELETE({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: 写失败测试（重试）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { POST } from '@/app/api/outbox/[id]/retry/route'
import { memDb } from '../../../helpers/memDb'

describe('POST /api/outbox/[id]/retry', () => {
  beforeEach(() => { const { db, raw } = memDb(); (require('@/lib/db') as any).__setDb(db); (globalThis as any).__raw = raw })

  it('failed → 重置 queued 立即重试', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status,attempts,error) VALUES ('a@b',?,'failed',5,'err')").run(0)
    const res = await POST({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(200)
    const row = raw.prepare('SELECT status, attempts, error, scheduled_at FROM outbox WHERE id=1').get()
    expect(row.status).toBe('queued'); expect(row.attempts).toBe(0); expect(row.error).toBeNull()
    expect(row.scheduled_at).toBeLessThanOrEqual(Date.now())
  })
  it('bounced 也可手动重试', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'bounced')").run(0)
    const res = await POST({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(200)
  })
  it('queued 不可重试 → 409', async () => {
    const raw = (globalThis as any).__raw
    raw.prepare("INSERT INTO outbox (to,scheduled_at,status) VALUES ('a@b',?,'queued')").run(Date.now() + 9999)
    const res = await POST({ params: Promise.resolve({ id: '1' }) } as any)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `/api/outbox/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { toLocalDisplay } from '@/lib/outbox/time'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const row = getDb().prepare('SELECT * FROM outbox WHERE id=?').get(Number(id))
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ item: { ...(row as any), scheduledAtLocal: toLocalDisplay((row as any).scheduled_at).label } })
}

/** 撤销发送:仅 status='queued' 可删(延迟窗口内)。已发/发送中 → 409。 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = getDb()
  const row = db.prepare('SELECT status FROM outbox WHERE id=?').get(Number(id)) as any
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status !== 'queued') {
    return NextResponse.json({ error: `无法撤销:状态为 ${row.status}(仅未发送的 queued 可撤销)` }, { status: 409 })
  }
  db.prepare('DELETE FROM outbox WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: 实现 `/api/outbox/[id]/retry/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/** 手动重试:仅 failed/bounced → 重置 queued + attempts=0 + 立即(scheduled_at=now)。 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = getDb()
  const row = db.prepare('SELECT status FROM outbox WHERE id=?').get(Number(id)) as any
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status !== 'failed' && row.status !== 'bounced') {
    return NextResponse.json({ error: `无法重试:状态为 ${row.status}(仅 failed/bounced 可重试)` }, { status: 409 })
  }
  db.prepare("UPDATE outbox SET status='queued', attempts=0, error=NULL, scheduled_at=? WHERE id=?").run(Date.now(), Number(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/outbox/\[id\]/route.ts src/app/api/outbox/\[id\]/retry/route.ts src/__tests__/api/outbox-cancel.test.ts src/__tests__/api/outbox-retry.test.ts
git commit -m "feat(api): outbox undo (DELETE queued) + manual retry (failed/bounced → queued)"
git push
```

---

### Task 9: 退信/NDR 错误信息可见化（UI 钩子 + 已在 worker 落 error）

**Files:**
- 主要是验证：Task 5 worker 已把退信/失败 `error` 写入 outbox.error、状态置 failed/bounced；Task 7/8 已暴露列表与重试。本任务把 worker 的退信判定从「错误信息关键词」扩展为更稳的判定 + 文档化 NDR 关键词列表。
- Modify: `src/lib/outbox/worker.ts`（`classifyFailure` 关键词扩充 + 注释 NDR 来源）
- Modify: `src/__tests__/outbox/worker.test.ts`（补 NDR 关键词用例）

**关键设计：** nodemailer 抛错时 `e.message` 对 SMTP 永久失败含 `550`/`User unknown`/`mailbox full`/`Recipient address rejected`；退信 NDR 邮件（异步投递失败回执）本版不解析正文（无 IMAP 拉取退信逻辑，超出范围），仅处理**同步 SMTP 拒绝**为 bounced。补充注释：异步退信解析为 P2 预留（worker 可后续订阅 `failure@` 收件箱解析 NDR）。

- [ ] **Step 1: 扩充 `classifyFailure` 关键词**：增加 `recipient address rejected`、`mailbox is full`、`message size exceeds`、`spam` 永久类 vs `4\d\d`（4xx 为瞬态）。

```ts
export function classifyFailure(errMsg: string): 'bounced' | 'transient' {
  const s = errMsg || ''
  // 4xx SMTP 状态码 = 瞬态(稍后重试);5xx = 永久(退信)
  if (/\b4\d\d\b/.test(s) && !/\b5\d\d\b/.test(s)) return 'transient'
  if (/550|551|552|553|554|user unknown|no such user|does not exist|recipient address rejected|mailbox (is )?full|message size exceeds|access denied|spam|blocked/i.test(s)) return 'bounced'
  return 'transient'
}
```

- [ ] **Step 2: 补测试**：`classifyFailure('451 timeout')` → transient；`classifyFailure('552 mailbox is full')` → bounced；`classifyFailure('554 Spam content rejected')` → bounced。

- [ ] **Step 3: 运行确认通过** → PASS。`npx vitest run src/__tests__/outbox/`。

- [ ] **Step 4: Commit**

```bash
git add src/lib/outbox/worker.ts src/__tests__/outbox/worker.test.ts
git commit -m "feat(outbox): expand NDR/bounce classification (4xx transient vs 5xx permanent)"
git push
```

---

### Task 10: ComposeMail 接入（发送入 outbox + 撤销浮层 + 模板插入）+ outbox 列表页

**Files:**
- Modify: `src/components/ComposeMail.tsx`
- Create: `src/components/UndoSendBar.tsx`
- Create: `src/app/outbox/page.tsx`（可选,Task Step 4）

**关键设计：**
- **发送流程改造**：ComposeMail「发送」按钮不再直调 `/api/send`，改调 `POST /api/outbox { sendMode:'undo' }`。返回 `{ id, scheduledAt, undoWindowSeconds }` → 顶部出现 `UndoSendBar`（倒计时 `undoWindowSeconds` → 0），用户点「撤销」→ `DELETE /api/outbox/[id]` → 成功则回到编辑态（恢复填写内容）；倒计时归零 → 浮层消失（worker 到点发）。
- **定时发送**：ComposeMail 加「定时发送」入口（日期时间选择器，浏览器本地时区）→ `sendMode:'schedule', scheduledAt:{date,time}` → 入 outbox，不出现撤销浮层（定时邮件无撤销窗口，可去 outbox 列表删除取消）。
- **模板插入**：ComposeMail 工具栏加「模板」下拉（`GET /api/templates`）→ 选中 → 若模板有变量，弹出变量填写框（列出 `extractVariables` 抽出的变量名）→ `applyTemplate(bodyHtml, vars)` → 插入编辑器。无变量直接插入。
- **outbox 列表页**（`/outbox`）：列 failed/bounced/queued，显示 error、scheduledAtLocal；failed/bounced 行「重试」按钮（`POST /api/outbox/[id]/retry`）；queued 行「撤销/删除」（`DELETE`）。sent 不列（已在已发送箱）。

- [ ] **Step 1: ComposeMail 发送改入 outbox（undo 模式）**：替换发送 onClick，调 `/api/outbox`，成功后渲染 UndoSendBar。

- [ ] **Step 2: UndoSendBar 组件**：props `{ outboxId, seconds, onUndo, onSent }`；`useEffect` 倒计时（setInterval），点撤销调 DELETE、调 onUndo 回编辑态；归零调 onSent（跳已发送/提示已发送）。

- [ ] **Step 3: 模板下拉插入**：工具栏加 select（选项来自 `GET /api/templates`）；onChange → 若 `variables.length>0` 弹窗收集值 → `applyTemplate` → 插入 RichTextEditor（复用现有编辑器 insert）；无变量直接插入。

- [ ] **Step 4: 定时发送入口**：ComposeMail「发送」旁加「定时」按钮 → 弹 `<input type="date">`+`<input type="time">`（本地）→ `sendMode:'schedule'` 入队 → toast「已定时,将于 X 发送」。

- [ ] **Step 5: outbox 列表页**（`src/app/outbox/page.tsx`）：`GET /api/outbox`（非 sent）→ 表格/卡片列 status/to/subject/scheduledAtLocal/error；行内「重试」「删除」按钮。

- [ ] **Step 6: 手测**：
  - 写邮件 → 发送 → UndoSendBar 出现倒计时 → 倒计时内撤销 → 回到编辑态；不撤销 → 到点发出（已发送箱可见）。
  - 定时发送选 1 分钟后 → outbox 列表 queued → 到点 sent。
  - 模板插入带变量 → 变量替换正确填入。
  - （模拟失败）断网发送 → outbox worker 失败重试（attempts 增、scheduledAt 后移）→ 达上限 failed → outbox 列表可见 error → 点重试 → queued 再发。

- [ ] **Step 7: Commit**

```bash
git add src/components/ComposeMail.tsx src/components/UndoSendBar.tsx src/app/outbox/page.tsx
git commit -m "feat(ui): compose sends via outbox (undo bar) + scheduled send + template insert + outbox list"
git push
```

---

## 验收标准

- [ ] **outbox/templates 表**：迁移 + Drizzle schema 存在；`outbox(id, account_id, to, cc, bcc, subject, body_html, scheduled_at[UTC ms], status[queued/sending/sent/failed/bounced], attempts, error)`、`templates(id, account_id, name, body_html, variables[JSON])` 字段齐全；`idx_outbox_scheduled(status, scheduled_at)` 索引存在。
- [ ] **状态机**：`transitionOutboxStatus()` 纯函数覆盖 queued→sending→sent/failed/bounced 全流转，非法流转抛错，终态不可再转；`nextAttemptAt()` 指数退避（30s→60s→…→封顶 30min）正确。
- [ ] **时区**：`scheduled_at` 全程存 UTC epoch ms；`toLocalDisplay`/`parseLocalToUtc` 正确（上海 09:30↔UTC 01:30、跨天）；API 返回 `scheduledAtLocal` 供显示。
- [ ] **定时发送**：`processOutbox()` worker 扫 `status='queued' AND scheduled_at<=now` → 经 `getSenderForAccount(accountId)` 发出 → 成功 sent+落 messages(direction=out)；scheduler 每分钟跑一次。
- [ ] **撤销发送**：发送默认 undo 模式（`scheduledAt=now+undoWindow`，窗口 5/10/20/30s 可配，settings `outbox.undoWindowSeconds`）；窗口内 `DELETE /api/outbox/[id]` 仅 queued 可删，sent/sending 返回 409。
- [ ] **失败/退信状态机**：瞬态失败指数退避重试（attempts 满 5 → failed）；退信（5xx/550/User unknown/Recipient rejected/Mailbox full）→ bounced 不重试；error 写库可见；`POST /api/outbox/[id]/retry` 手动重置 failed/bounced → queued 立即重发。
- [ ] **模板**：`applyTemplate` 替换 `{{var}}`（未提供留空、同名多替换、保留 HTML）；`extractVariables` 去重；`/api/templates` GET/POST/DELETE，POST 自动抽 variables。
- [ ] **UI**：ComposeMail 发送经 outbox + UndoSendBar 倒计时撤销；定时发送入口；模板下拉插入带变量填写；outbox 列表页（failed/bounced/queued 可见可重试/删除）。
- [ ] `npm test` 全绿（outbox/{status,time,worker}、templates/render、api/{outbox,outbox-cancel,outbox-retry,templates}）。
- [ ] `npx tsc --noEmit` 无类型错误。
- [ ] （P2 预留）邮件合并 mail merge（批量 outbox 入队 + per-recipient 变量）、已读回执（MDN 解析）、异步退信 NDR 邮件正文解析——本计划不实现，仅 worker 注明预留。

## 依赖

- **子项目 1**：drizzle 迁移框架（`drizzle/*.sql` + `migrate()` + align-baseline）——本计划 Task 1 的迁移 SQL 依赖该框架执行；若 plan-01 未就绪，临时退化用 `getDb()` 的 `autoCreateTables` 补 outbox/templates 两表 CREATE（与现状机制一致），但**强烈建议**先落 plan-01。
- **子项目 2**：`accounts` 表 + `getSenderForAccount(accountId)` 按 accountId 从 accounts 读 SMTP 配置构造 MailSender。当前 `MailSender` 已支持 `{host,port,user,authCode}` 注入；plan-02 补「读 accounts 表」。**未就绪时**：worker 的 `getSenderForAccount` env 回落（`new MailSender()` 单账号），签名稳定，plan-02 落地后填实现，不改调用方。
- **子项目 5**：ComposeMail 的 to/cc/bcc/草稿流程；本计划改造其发送入口（`/api/send` → `/api/outbox`），不重写编辑器。
- 现有 `src/lib/scheduler/index.ts`（node-cron，注册 worker）、`src/lib/adapter/mail/sender.ts`（MailSender）、`src/components/ComposeMail.tsx`、`src/components/RichTextEditor.tsx`（模板插入）。

## 风险

- **plan-01/02 未就绪**：迁移框架缺失 → outbox/templates 表建不出；accounts 表缺失 → 多账号按 accountId 发送退化单账号。**缓解**：Task 1 memDb helper 自带建表（测试不依赖迁移）；worker `getSenderForAccount` try/catch env 回落；UI 用单账号仍可用。文档标注两依赖项为硬前置（生产部署需 plan-01）。
- **时区换算错误**：`parseLocalToUtc` 的偏移计算在不同测试机时区可能符号反。**缓解**：纯函数可单测固定用例（上海 09:30→UTC 01:30、跨天）；实现用 `Intl.DateTimeFormat` en-CA 格式（稳定 YYYY-MM-DD）；测试断言 ISO 字符串而非相对毫秒。
- **worker 与 API 并发**：用户撤销（DELETE）与 worker 抢同一条（queued→sending）竞态——worker 已置 sending 后 DELETE 应被拒。**缓解**：DELETE 仅允许 status='queued'，worker 改 sending 与 DELETE 都走 DB 事务（`UPDATE ... WHERE status='queued'` 受影响行数判断），受影响 0 行即已被 worker 接管 → DELETE 返回 409。
- **退信判定误判**：关键词匹配可能把瞬态当永久（或反之），导致该重试的转 failed、或不该重试的死循环。**缓解**：4xx=瞬态/5xx=永久 的 SMTP 状态码优先于关键词；关键词列表保守（仅明确永久拒绝词）；bounced 仍可手动重试（POST retry），不锁死。
- **撤销窗口过短/用户离开页面**：UndoSendBar 倒计时进行中用户切走 → 撤销机会丢失（邮件照发）。**缓解**：窗口默认 10s 可配到 30s；outbox 列表 queued 也可删除取消（定时邮件同理）；本地单机单用户，跨标签页撤销非刚需（P2 可用 SSE 广播撤销）。
- **scheduler 单进程崩溃**：worker 跟随 Next 进程，进程挂了定时邮件不发。**缓解**：outbox 持久化在 DB，进程重启后 scheduler 启动即补扫到点的 queued（worker 不丢已排队）；plan-17 的 launchd KeepAlive 崩溃重启保证进程存活。
- **模板变量注入 XSS**：`applyTemplate` 把用户输入 vars 直接拼进 body_html，若 vars 含 `<script>` 则发信含恶意 HTML。**缓解**：发信侧 body_html 本就是用户自撰内容（发件方负责），非收件渲染侧；收件渲染的 DOMPurify 净化在 plan-11；模板 vars 建议来源为联系人/手填可信数据。
