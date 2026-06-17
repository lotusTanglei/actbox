# 子项目 16 — 日历与日程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 actbox 加一个**内置日历（companion 能力）**——`events` 表 + 日/周/月视图 + 创建/编辑/删除日程 + 到点桌面提醒（复用 plan-06 的 EventBus + Notifications）；并打通邮件侧「一键转日程 / 转任务」（转任务复用现有 todo-email linking，补 UI 入口）；会议邀请 `.ics` 收发、通知中心、CalDAV/Exchange 同步作为 **P2 预留接口**（本期不实现）。

**Architecture:** 方案 B（详见 spec §0/子项目 16）。本地单机、单进程、单 SQLite(WAL)、单用户不变。核心原则是**复用不重造**：

1. **本地事件表 + 视图**：新增独立 `events` 表（本地日历，非远端账户体系）。日历视图（日/周/月）是**纯函数 + 渲染层**——月格生成、周/日区间切分用纯函数 `lib/calendar/grid.ts`（无副作用、可单测），UI 组件只做渲染 + 创建/编辑/删除。`starts_at`/`ends_at` **一律存 UTC 毫秒整数**（显示时按用户时区 `Intl.DateTimeFormat` 转，时区取 `settings.timezone`，默认 `Asia/Shanghai`）；`all_day` 事件按本地日历日整天。
2. **提醒复用通知总线（不重造通知）**：plan-06 已建 `src/lib/events/eventBus.ts`（`eventBus.publish({ type, payload })` 带单调 `seq`）+ `src/components/realtime/Notifications.tsx`（Notification API 桌面通知 + 授权 + 分级）。**本计划只做提醒调度器** `ReminderScheduler`：node-cron 每分钟 tick，查 `events` 表中 `starts_at - reminder_minutes <= now` 且尚未提醒过的事件，经 `eventBus.publish({ type: 'calendar-reminder', payload })` 发事件 → plan-06 的 `Notifications.tsx` 负责弹桌面通知。**不在本计划重写通知/授权/SSE。**
3. **邮件转日程 / 转任务**：邮件详情页加两个动作入口。转日程 = `POST /api/events` 预填 `{ title: 邮件主题, source_message_id: 邮件 messageId, description: 邮件摘要, account_id: 邮件所属账号 }` 后跳日历编辑器；转任务 = `POST /api/todos`（现有路由）预填 `{ title, source_message_id, source_subject, source_from }`——**转任务完全复用现有 todo-email linking（`todos.source_message_id`）**，本计划只补「转任务」UI 入口 + 对应 compose 调用，不动 todo 表/路由。
4. **会议邀请 / 通知中心 / CalDAV 为 P2**：`.ics` 生成/解析只给纯函数接口（`lib/calendar/ics.ts`，P2 内联标注「预留」），CalDAV/Exchange 给 adapter 占位接口签名（P2 节），本期不实现逻辑、不引依赖。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle + better-sqlite3 / vitest / node-cron（已在依赖中）。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 2（`accounts` 表 + `account_id`，转日程按邮件账号归属）、6（`eventBus.ts` + `Notifications.tsx` + SSE，提醒经此推桌面通知）、8/现有（todo-email linking，`todos.source_message_id`）。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。API route 测试对 `getDb()` 注入内存库（`memDb` helper，参考 plan-14/15 约定；复用既有 helper，补本计划所需表/列）。UI 视觉/交互部分以手测覆盖，纯逻辑（月格生成、周/日区间、UTC↔本地换算、提醒触发判定、.ics 序列化、邮件→事件映射）以单测覆盖。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — 新增 `events` 表定义（drizzle）
- Modify: `src/lib/db/index.ts` — `autoCreateTables` 内补 `events` 表 `CREATE TABLE` + 索引（首次建表分支）；存量库经 plan-01 迁移框架补表（本计划提供迁移 SQL 片段）
- Create: `src/app/api/events/route.ts` — 事件列表（按区间 `?from=&to=`）+ 创建（GET/POST）
- Create: `src/app/api/events/[id]/route.ts` — 单事件 GET/PATCH/DELETE
- Create: `src/lib/calendar/grid.ts` — 纯函数：月格生成 `buildMonthGrid(year,month,weekStartsOn)`、周区间 `buildWeekRange(date)`、日区间 `buildDayRange(date)`、UTC 换算 `toUtcMs`/`fromUtcMs`、按区间筛选事件 `eventsInInterval`
- Create: `src/lib/calendar/reminder.ts` — 纯函数 `dueReminders(events, now)` 返回 `[{event, fireAt}]`（`starts_at - reminder_minutes*60000 <= now`）；驱动器 `startReminderScheduler(opts)`（node-cron `* * * * *` 每分钟 tick，查库 → `eventBus.publish`）
- Create: `src/lib/calendar/ics.ts` — `.ics` 生成 `toIcs(event)` + 解析 `parseIcs(text)`（**P2 预留**，本期只实现序列化 + 基础解析，不做 RSVP/时区块）
- Create: `src/lib/calendar/convert.ts` — 邮件 → 事件 / 邮件 → todo 的预填映射纯函数 `mailToEventDraft(mail)`/`mailToTodoDraft(mail)`
- Create: `src/app/api/events/from-mail/route.ts` — `POST { messageId }` 预读邮件 → 返回事件草稿（前端再 POST `/api/events` 落库）；转任务直接复用 `POST /api/todos`
- Create: `src/app/calendar/page.tsx` — 日历主页（视图切换 日/周/月 + 事件 CRUD）
- Create: `src/components/calendar/CalendarView.tsx` — 视图容器（当前视图 + 日期游标 + 切换 + 「今天」+ 新建按钮）
- Create: `src/components/calendar/MonthView.tsx` — 月视图（6×7 网格，格内事件 chip + 更多折叠 + 点击新建/编辑）
- Create: `src/components/calendar/WeekView.tsx` — 周视图（7 列 × 时段行，事件块绝对定位）
- Create: `src/components/calendar/DayView.tsx` — 日视图（单列时段 + 事件块）
- Create: `src/components/calendar/EventEditor.tsx` — 创建/编辑表单（标题/全天/起止/地点/描述/提醒分钟 + 来源邮件回链）
- Create: `src/components/calendar/useEvents.ts` — 客户端 hook：按当前视图区间拉 `/api/events?from=&to=` + CRUD + 变更后 invalidate
- Modify: `src/components/nav/AppShell.tsx` — 侧栏加「日历」入口（→ `/calendar`）
- Modify: `src/app/mails/[id]/page.tsx`（或邮件详情动作区组件）— 加「转日程」「转任务」按钮
- Modify: `src/app/api/events/route.ts` 同时承载 GET/POST；`Notification`/EventBus 接入见 Task 4
- Test: `src/__tests__/calendar/grid.test.ts`、`src/__tests__/calendar/reminder.test.ts`、`src/__tests__/calendar/ics.test.ts`、`src/__tests__/calendar/convert.test.ts`、`src/__tests__/api/events.test.ts`、`src/__tests__/api/events-from-mail.test.ts`
- Create（测试 helper）: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 全表建表（若 plan-14/15 已建则复用并补 `events` 表）

---

## 任务

### Task 1: `events` 表 + Schema 落地

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`
- Test: `src/__tests__/db/calendar-schema.test.ts`（或并入既有 `schema.test.ts`）

**关键设计：**
- **`events` 表**（DDL，与 spec §16 一致）：

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,                          -- 所属账号（邮件转日程时取邮件账号）；NULL 表示纯本地日程
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,                  -- UTC 毫秒（all_day 时为该本地日 00:00 的 UTC 毫秒）
  ends_at INTEGER,                             -- UTC 毫秒；all_day 且未填时 = starts_at + 1 天
  all_day INTEGER NOT NULL DEFAULT 0,          -- 0/1
  location TEXT,
  description TEXT,
  reminder_minutes INTEGER,                    -- NULL = 不提醒；>=0 = 提前 N 分钟提醒
  source_message_id TEXT,                      -- 来源邮件 messageId（邮件转日程，双向回链）
  reminded_at INTEGER,                         -- 已提醒时间戳（去重，防重复弹窗）；NULL = 未提醒
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_message_id);
```

- **drizzle 定义**（`schema.ts`）：

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id'),
  title: text('title').notNull(),
  startsAt: integer('starts_at').notNull(),                 // UTC ms
  endsAt: integer('ends_at'),
  allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
  location: text('location'),
  description: text('description'),
  reminderMinutes: integer('reminder_minutes'),
  sourceMessageId: text('source_message_id'),
  remindedAt: integer('reminded_at'),
  createdAt: integer('created_at').notNull().$defaultFn(() => new Date()),
})
```

- **存量库**：plan-01 已建迁移框架（`db:migrate` + `align-baseline`），本表随该框架 `CREATE TABLE IF NOT EXISTS` 补入；若工作树 plan-01 未落地，则 `autoCreateTables` 的建表分支直接 exec 上列 SQL（首次建表判据仍以 `todos` 表存在性，故需在 `autoCreateTables` 末尾追加一段**幂等** `CREATE TABLE IF NOT EXISTS events ...`，对存量库每次启动安全补建——与 plan-15 的 `hasColumn`/`tableExists` 探测约定一致）。

- [ ] **Step 1: 写 schema 失败测试**

```ts
// src/__tests__/db/calendar-schema.test.ts
import { describe, it, expect } from 'vitest'
import { getDb } from '@/lib/db'
import { events } from '@/lib/db/schema'

describe('events table', () => {
  it('insert/select events with UTC ms timestamps + all_day + reminder + source', () => {
    const db = getDb()
    const [row] = db.insert(events).values({
      accountId: 1,
      title: '周会',
      startsAt: Date.UTC(2026, 5, 17, 1, 0),   // 2026-06-17 09:00 CST → UTC 01:00
      endsAt: Date.UTC(2026, 5, 17, 2, 0),
      allDay: false,
      location: '会议室 A',
      reminderMinutes: 15,
      sourceMessageId: '<abc@mail>',
    }).returning().all()
    expect(row.title).toBe('周会')
    expect(typeof row.startsAt).toBe('number')           // UTC ms
    expect(row.allDay).toBe(false)
    expect(row.reminderMinutes).toBe(15)
    const got = db.select().from(events).where(/* by id */ ).all()
    expect(got.length).toBe(1)
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/db/calendar-schema.test.ts` → FAIL（events 表/符号不存在）。
- [ ] **Step 3: 在 `schema.ts` 加 `events` 定义（上列代码）；在 `db/index.ts` 的 `autoCreateTables` 末尾追加幂等 `CREATE TABLE IF NOT EXISTS events ...` + 索引（上列 SQL）。**
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/db/calendar-schema.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts src/__tests__/db/calendar-schema.test.ts
git commit -m "feat(calendar): events table (UTC ms timestamps, all_day, reminder_minutes, source_message_id, reminded_at)"
git push
```

---

### Task 2: 日历网格纯函数（月/周/日区间 + UTC 换算 + 区间筛选）

**Files:**
- Create: `src/lib/calendar/grid.ts`
- Test: `src/__tests__/calendar/grid.test.ts`

**关键设计：** 全部纯函数，无 IO，无时区库（用 `Date` + `Intl.DateTimeFormat`）。
- `weekStartsOn` 默认 `1`（周一，国内习惯），可配 `0`(日)。
- **月格**：返回 6×7 = 42 个 `{date: Date, inMonth: boolean}`，首格为本月第一天所在周的第一天（按 `weekStartsOn` 回退）。
- **周区间**：给定任一日期，返回该周 `[start, end]`（7 天，`weekStartsOn` 对齐）的 `{startMs, endMs}`（UTC ms，半开区间 `[start, end)`）。
- **日区间**：给定日期本地 00:00 → 次日 00:00（按 `settings.timezone`，默认 `Asia/Shanghai`），返回 UTC ms `[start, end)`。
- **区间筛选** `eventsInInterval(evts, startMs, endMs)`：事件与区间相交即入选（`event.startsAt < endMs && (event.endsAt ?? event.startsAt) > startMs`）。
- **UTC 换算** `toUtcMs(localDate)`/`fromUtcMs(utcMs, tz)`：用 `Intl.DateTimeFormat(tz,...)` 读各分量后 `Date.UTC`。all_day 事件 `startsAt` 存「该本地日 00:00 的 UTC ms」。

- [ ] **Step 1: 写纯函数失败测试**

```ts
// src/__tests__/calendar/grid.test.ts
import { describe, it, expect } from 'vitest'
import { buildMonthGrid, buildWeekRange, buildDayRange, eventsInInterval, toUtcMs } from '@/lib/calendar/grid'

describe('buildMonthGrid', () => {
  it('2026-06 首格为 2026-05-25（周一起周）共 42 格', () => {
    const grid = buildMonthGrid(2026, 5, 1)          // month 0-indexed: 5 = June
    expect(grid).toHaveLength(42)
    expect(grid[0].date.getDate()).toBe(25)
    expect(grid[0].date.getMonth()).toBe(4)          // May
    expect(grid[0].inMonth).toBe(false)
    const firstJune = grid.find(c => c.inMonth)!
    expect(firstJune.date.getMonth()).toBe(5)
  })
  it('weekStartsOn=0 首格退到周日', () => {
    const grid = buildMonthGrid(2026, 5, 0)
    expect(grid[0].date.getDay()).toBe(0)
  })
})

describe('buildWeekRange / buildDayRange', () => {
  it('周区间为周一 00:00 ~ 下周一 00:00 的 UTC ms 半开区间', () => {
    const { startMs, endMs } = buildWeekRange(new Date(2026, 5, 17), 1)   // Wed
    expect(endMs - startMs).toBe(7 * 86400000)
    expect(new Date(startMs).getDay()).toBe(1)                            // UTC 注意：这里断言按 tz 本地分量
  })
  it('日区间 = 24h', () => {
    const { startMs, endMs } = buildDayRange(new Date(2026, 5, 17), 'Asia/Shanghai')
    expect(endMs - startMs).toBe(86400000)
  })
})

describe('eventsInInterval', () => {
  const E = (s: number, e: number) => ({ startsAt: s, endsAt: e })
  it('相交入选，跨天事件入选，区间外排除', () => {
    const day = buildDayRange(new Date(2026, 5, 17), 'Asia/Shanghai')
    const evts = [E(day.startMs + 3600000, day.startMs + 7200000),     // 区间内
                  E(day.startMs - 3600000, day.startMs + 3600000),     // 跨左边界
                  E(day.endMs + 1000, day.endMs + 2000)]               // 区间外
    const got = eventsInInterval(evts as any, day.startMs, day.endMs)
    expect(got).toHaveLength(2)
  })
})

describe('toUtcMs', () => {
  it('all_day: 本地 00:00 → UTC ms', () => {
    const ms = toUtcMs(new Date(2026, 5, 17, 0, 0), 'Asia/Shanghai')
    expect(ms).toBe(Date.UTC(2026, 5, 16, 16, 0))     // CST 06-17 00:00 = UTC 06-16 16:00
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/calendar/grid.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/lib/calendar/grid.ts`**（上列纯函数；周/日区间用 `Intl.DateTimeFormat(tz,{...})` 拆本地分量 + `Date.UTC` 重装）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/calendar/grid.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/calendar/grid.ts src/__tests__/calendar/grid.test.ts
git commit -m "feat(calendar): pure grid helpers (month/week/day ranges + UTC<->local + interval filter)"
git push
```

---

### Task 3: 事件 API（列表按区间 + CRUD）

**Files:**
- Create: `src/app/api/events/route.ts`
- Create: `src/app/api/events/[id]/route.ts`
- Test: `src/__tests__/api/events.test.ts`

**关键设计：**
- `GET /api/events?from=<ms>&to=<ms>` → 查 `starts_at < to` 且 `ends_at`(或 starts_at) `> from` 的事件（区间相交，复用 `eventsInInterval` 语义但在 SQL 层用 `gte/lt`）。返回 `{ events: [...] }`。
- `POST /api/events` `{ accountId?, title, startsAt, endsAt?, allDay?, location?, description?, reminderMinutes?, sourceMessageId? }` → 落库，`remindedAt=null`，返回新建行（201）。
- `GET /api/events/[id]` / `PATCH`（改任意字段，改 `startsAt`/`reminderMinutes` 时**重置 `remindedAt=null`** 以便重新提醒）/ `DELETE`。
- 校验：`title` 非空；`startsAt` 必填且为整数；`allDay` 为真且无 `endsAt` 时服务端补 `endsAt = startsAt + 86400000`。
- **`account_id` 容错**：accounts 表（plan-02）若未落地，`accountId` 写入仍允许（列允许 NULL，不强外键）——以 events CRUD 测试全绿为准。

- [ ] **Step 1: 写 API 失败测试**

```ts
// src/__tests__/api/events.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET, POST } from '@/app/api/events/route'
import { PATCH, DELETE } from '@/app/api/events/[id]/route'
import { memDb } from '../helpers/memDb'

function req(url: string, init: any = {}) {
  return new Request(url, { headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => { (getDb as any).__setDb?.(memDb()) })   // 或按 memDb helper 约定注入
function getDb() { return (require('@/lib/db') as any).getDb() }

describe('events API', () => {
  it('POST 建事件返回 201 + remindedAt=null', async () => {
    const r = await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ title: '周会', startsAt: Date.now(), reminderMinutes: 10 }) }) as any)
    expect(r.status).toBe(201)
    const j = await r.json()
    expect(j.event.title).toBe('周会')
    expect(j.event.remindedAt).toBeNull()
  })
  it('POST title 缺失 400', async () => {
    const r = await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ startsAt: Date.now() }) }) as any)
    expect(r.status).toBe(400)
  })
  it('all_day 无 endsAt 自动补一天', async () => {
    const s = Date.UTC(2026, 5, 17, 0, 0)
    const r = await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ title: '全天', startsAt: s, allDay: true }) }) as any)
    const j = await r.json()
    expect(j.event.endsAt - j.event.startsAt).toBe(86400000)
  })
  it('GET ?from=&to= 按区间相交返回', async () => {
    const d = Date.UTC(2026, 5, 17, 1, 0)
    await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ title: 'A', startsAt: d, endsAt: d + 3600000 }) }) as any)
    const r = await GET(req('http://x/api/events?from=' + d + '&to=' + (d + 7200000)) as any)
    const j = await r.json()
    expect(j.events.length).toBeGreaterThanOrEqual(1)
  })
  it('PATCH 改 startsAt 重置 remindedAt=null', async () => {
    const created = await (await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ title: 'B', startsAt: Date.now() }) }) as any)).json()
    // 人为标记已提醒
    getDb().prepare('UPDATE events SET reminded_at=? WHERE id=?').run(Date.now(), created.event.id)
    const r = await PATCH(req('http://x/api/events/' + created.event.id, { method: 'PATCH', body: JSON.stringify({ startsAt: Date.now() + 60000 }) }) as any, { params: Promise.resolve({ id: String(created.event.id) }) } as any)
    const j = await r.json()
    expect(j.event.remindedAt).toBeNull()
  })
  it('DELETE 返回 ok', async () => {
    const created = await (await POST(req('http://x/api/events', { method: 'POST', body: JSON.stringify({ title: 'C', startsAt: Date.now() }) }) as any)).json()
    const r = await DELETE(req('http://x/api/events/' + created.event.id) as any, { params: Promise.resolve({ id: String(created.event.id) }) } as any)
    expect(r.status).toBe(200)
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/api/events.test.ts` → FAIL（路由不存在）。
- [ ] **Step 3: 实现 `/api/events/route.ts`（GET/POST）+ `/api/events/[id]/route.ts`（GET/PATCH/DELETE）**，校验 + all_day 补尾 + PATCH 重置 `remindedAt`。memDb helper 补 `events` 表（与 Task 1 DDL 一致）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/api/events.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/app/api/events/ src/__tests__/api/events.test.ts src/__tests__/helpers/memDb.ts
git commit -m "feat(calendar): events API (range query GET + CRUD, all_day endsAt default, patch resets reminder)"
git push
```

---

### Task 4: 提醒调度器（node-cron 每分钟 tick → EventBus）

**Files:**
- Create: `src/lib/calendar/reminder.ts`
- Test: `src/__tests__/calendar/reminder.test.ts`

**关键设计：**
- **纯函数 `dueReminders(events, now)`**：对每个事件算 `fireAt = startsAt - (reminderMinutes ?? <不提醒>)*60000`；若 `reminderMinutes != null` 且 `fireAt <= now` 且 `remindedAt == null` → 纳入待提醒列表 `[{event, fireAt}]`。这是核心可测逻辑（不碰 IO/cron）。
- **驱动器 `startReminderScheduler({ cron='* * * * *', publish })`**：用 node-cron 每分钟跑一次：查库 `SELECT ... WHERE reminder_minutes IS NOT NULL AND reminded_at IS NULL AND (starts_at - reminder_minutes*60000) <= ?`（`?` = now）→ 对每条 `publish({ type: 'calendar-reminder', payload: { eventId, title, startsAt, location } })` → `UPDATE events SET reminded_at=? WHERE id=?`（去重）。返回 `{ stop }`。
- **接 EventBus**：`publish` 默认绑定 plan-06 的 `eventBus.publish`；测试注入 `vi.fn()`。前端 `Notifications.tsx`（plan-06）已监听 `calendar-reminder` 类型弹桌面通知——**本计划不重写通知**，仅在 plan-06 的事件类型联合里补 `'calendar-reminder'`（若 plan-06 类型未含，在 Task 4 内补一行类型扩展 + 注明归属 plan-16）。
- **启动时机**：随 plan-06 的实时性 bootstrap（或本计划在日历页/应用初始化惰性启动）。若 plan-06 未落地，`startReminderScheduler` 仍可独立跑（publish 打到 `eventBus` 或降级 `console.warn`）。

- [ ] **Step 1: 写纯函数 + 驱动器失败测试**

```ts
// src/__tests__/calendar/reminder.test.ts
import { describe, it, expect, vi } from 'vitest'
import { dueReminders, startReminderScheduler } from '@/lib/calendar/reminder'

const NOW = 1_000_000
const ev = (over: any) => ({ id: 1, title: '周会', startsAt: NOW + 10*60000, reminderMinutes: 15, remindedAt: null, endsAt: null, location: 'A', ...over })

describe('dueReminders', () => {
  it('reminderMinutes=null 不提醒', () => {
    expect(dueReminders([ev({ reminderMinutes: null })], NOW)).toHaveLength(0)
  })
  it('fireAt<=now 且未提醒 → 待提醒', () => {
    expect(dueReminders([ev({ startsAt: NOW + 5*60000, reminderMinutes: 10 })], NOW)).toHaveLength(1) // fireAt=NOW-5min
  })
  it('已提醒(remindedAt!=null) 跳过', () => {
    expect(dueReminders([ev({ startsAt: NOW - 60000, remindedAt: NOW - 1 })], NOW)).toHaveLength(0)
  })
  it('未到 fireAt 跳过', () => {
    expect(dueReminders([ev({ startsAt: NOW + 60*60000, reminderMinutes: 15 })], NOW)).toHaveLength(0)
  })
})

describe('startReminderScheduler', () => {
  it('tick 查库 → publish calendar-reminder → 置 reminded_at', async () => {
    const db = memDb()                                 // 含 events 表，插一条到期未提醒事件
    db.prepare('INSERT INTO events(title,starts_at,reminder_minutes,reminded_at) VALUES(?,?,?,?)')
      .run('周会', NOW - 60000, 5, null)
    const publish = vi.fn()
    const { stop } = startReminderScheduler({ db, publish, cron: '* * * * *', now: () => NOW })
    await tick()                                        // 驱动器导出 _tick() 供测，或暴露 runOnce()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'calendar-reminder', payload: expect.objectContaining({ title: '周会' }) }))
    const row = db.prepare('SELECT reminded_at FROM events WHERE id=1').get()
    expect(row.reminded_at).not.toBeNull()
    stop()
  })
})
```

> 注：驱动器应导出 `runOnce(db, { publish, now })` 便于单测直接调用，避免依赖真实 cron 触发；`startReminderScheduler` 内部 `cron.schedule(cron, () => runOnce(...))`。

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/calendar/reminder.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/lib/calendar/reminder.ts`**：`dueReminders`（纯）+ `runOnce`（查库 → publish → UPDATE）+ `startReminderScheduler`（cron 包裹）。plan-06 事件类型联合补 `'calendar-reminder'`（payload `{ eventId, title, startsAt, location? }`）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/calendar/reminder.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/calendar/reminder.ts src/__tests__/calendar/reminder.test.ts
git commit -m "feat(calendar): reminder scheduler (per-min cron tick -> EventBus calendar-reminder, reminded_at dedup)"
git push
```

---

### Task 5: 邮件转日程 / 转任务（映射纯函数 + from-mail 端点 + UI 入口）

**Files:**
- Create: `src/lib/calendar/convert.ts`
- Create: `src/app/api/events/from-mail/route.ts`
- Modify: `src/app/mails/[id]/page.tsx`（邮件详情动作区）+ 必要的 todo POST 调用
- Test: `src/__tests__/calendar/convert.test.ts`
- Test: `src/__tests__/api/events-from-mail.test.ts`

**关键设计：**
- **`mailToEventDraft(mail)`**（纯）：从邮件 `{ messageId, subject, from, body?, accountId }` 生成事件草稿 `{ title: subject||'(无主题)', sourceMessageId: messageId, description: body 预览前 300 字, accountId }`，`startsAt`/`endsAt` 留空交用户在编辑器补。
- **`mailToTodoDraft(mail)`**（纯）：复用现有 todo-email linking 字段 → `{ title: subject, sourceMessageId: messageId, sourceSubject: subject, sourceFrom: from, dueDate: <可选，若邮件正文/主题含日期则尝试解析，否则 null> }`。落库走现有 `POST /api/todos`（**不改 todo 表/路由**）。
- **`POST /api/events/from-mail` `{ messageId }`**：查 `messages` 表取邮件 → 返回 `mailToEventDraft` 结果（前端拿到再 POST `/api/events` 落库，跳日历编辑器）。messages 表 `accountId` 列若未落地（plan-01 未完成）则 `accountId` 返回 `null`（容错）。
- **UI 入口**：邮件详情页动作区加两个按钮「📅 转日程」「✅ 转任务」。转日程 → 调 from-mail → 拿草稿 → 打开 `EventEditor` 预填；转任务 → `POST /api/todos`（mailToTodoDraft 预填）→ toast + `emitRefresh()`（刷新待办计数，复用现有 `refresh-bus`/eventBus）。

- [ ] **Step 1: 写映射纯函数 + 端点失败测试**

```ts
// src/__tests__/calendar/convert.test.ts
import { describe, it, expect } from 'vitest'
import { mailToEventDraft, mailToTodoDraft } from '@/lib/calendar/convert'

describe('mailToEventDraft', () => {
  it('主题→title, messageId→source, body 截 300', () => {
    const d = mailToEventDraft({ messageId: '<m1>', subject: '周五评审', from: 'a@b', body: 'x'.repeat(500), accountId: 2 })
    expect(d.title).toBe('周五评审')
    expect(d.sourceMessageId).toBe('<m1>')
    expect(d.accountId).toBe(2)
    expect(d.description!.length).toBe(300)
  })
  it('无主题回退 (无主题)', () => {
    expect(mailToEventDraft({ messageId: '<m>', subject: null, from: 'a', accountId: 1 }).title).toBe('(无主题)')
  })
})

describe('mailToTodoDraft', () => {
  it('填充 todo-email linking 字段', () => {
    const t = mailToTodoDraft({ messageId: '<m1>', subject: '需跟进', from: 'a@b' })
    expect(t).toMatchObject({ title: '需跟进', sourceMessageId: '<m1>', sourceSubject: '需跟进', sourceFrom: 'a@b' })
    expect(t.dueDate).toBeNull()
  })
})
```

```ts
// src/__tests__/api/events-from-mail.test.ts（注入 memDb 含 messages 表）
it('POST {messageId} 返回事件草稿（从 messages 表读邮件）', async () => {
  const db = memDb()
  db.prepare('INSERT INTO messages(message_id,subject,sender,account_id) VALUES(?,?,?,?)').run('<m1>','评审','a@b',2)
  ;(getDb as any).__setDb(db)
  const r = await POST(req('http://x/api/events/from-mail', { method:'POST', body: JSON.stringify({ messageId:'<m1>' }) }) as any)
  expect(r.status).toBe(200)
  const j = await r.json()
  expect(j.draft.title).toBe('评审')
  expect(j.draft.sourceMessageId).toBe('<m1>')
})
it('邮件不存在 404', async () => {
  ;(getDb as any).__setDb(memDb())
  const r = await POST(req('http://x/api/events/from-mail', { method:'POST', body: JSON.stringify({ messageId:'<nope>' }) }) as any)
  expect(r.status).toBe(404)
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/calendar/convert.test.ts src/__tests__/api/events-from-mail.test.ts` → FAIL（模块/路由不存在）。
- [ ] **Step 3: 实现 `convert.ts`（两个纯函数）+ `/api/events/from-mail/route.ts`（查 messages → mailToEventDraft）+ 邮件详情页两按钮 UI（转任务调 `POST /api/todos`）**。messages 表无 `account_id` 列时 `accountId` 返回 null（容错，不崩）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/calendar/convert.test.ts src/__tests__/api/events-from-mail.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/calendar/convert.ts src/app/api/events/from-mail/ src/app/mails/[id]/page.tsx src/__tests__/calendar/convert.test.ts src/__tests__/api/events-from-mail.test.ts
git commit -m "feat(calendar): mail->event / mail->todo convert (pure mappers + from-mail endpoint + detail-page actions)"
git push
```

---

### Task 6: 日历视图 UI（日/周/月 + EventEditor + 数据 hook）+ 侧栏入口

**Files:**
- Create: `src/app/calendar/page.tsx`
- Create: `src/components/calendar/CalendarView.tsx`
- Create: `src/components/calendar/MonthView.tsx`
- Create: `src/components/calendar/WeekView.tsx`
- Create: `src/components/calendar/DayView.tsx`
- Create: `src/components/calendar/EventEditor.tsx`
- Create: `src/components/calendar/useEvents.ts`
- Modify: `src/components/nav/AppShell.tsx`
- Test: `src/__tests__/calendar/useEvents.test.ts`（hook 数据流：拉区间 + CRUD invalidate，可 mocked fetch）

**关键设计：**
- **`useEvents()`**：内部维护 `cursor`（当前日期游标）+ `view`（month/week/day）。根据 view 算 `[from,to]` 区间（复用 Task 2 纯函数）→ `GET /api/events?from=&to=`。提供 `create/update/remove` → 调对应 API → 失效重拉 + `emitRefresh()`。
- **MonthView**：6×7 网格（`buildMonthGrid`），每格列出当日事件 chip（`eventsInInterval` 按日过滤），格内「+」新建（预填该日）；chip 点击进编辑器；超出 N 条折叠「还有 M 项」。标题行 周一~周日（按 `weekStartsOn`）。
- **WeekView / DayView**：时段轴（0~24h，可仅显示工作时间 7~22 区段 + 全天置顶栏），事件块按 `startsAt/endsAt` 绝对定位高度（`all_day` 置全天栏）。空白时段拖选/点击新建（预填起止，P1 先做点击新建，拖选可 P2）。
- **EventEditor**（Modal/抽屉）：title 输入 / allDay 切换（切换时起止从 datetime → date）/ 起止 datetime-local / 地点 / 描述 / reminderMinutes select（不提醒/5/10/15/30/60） / 来源邮件回链（`sourceMessageId` 存在时显示「来自邮件：xxx」+ 跳转）；保存调 POST/PATCH，删除调 DELETE。
- **时间显示**：`startsAt`(UTC ms) 经 `Intl.DateTimeFormat(locale, { timeZone: settings.timezone })` 显示本地时间。`settings.timezone` 缺省 `Asia/Shanghai`，`locale` 缺省 `zh-CN`（plan-15 i18n 衔接；未落地时硬编码）。
- **侧栏**：`AppShell` 加「日历」项 → `/calendar`。
- **提醒接入**：日历页加载时惰性 `startReminderScheduler()`（幂等：已启动则跳过）；桌面通知由 plan-06 `Notifications.tsx` 统一弹。

- [ ] **Step 1: 写 `useEvents` hook 数据流失败测试**（mocked `fetch`：拉区间返回事件；create 后重新拉取；view 切换改区间）。视图组件本身以手测为主。
- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/calendar/useEvents.test.ts` → FAIL。
- [ ] **Step 3: 实现 `useEvents.ts` + 5 个视图组件 + `EventEditor` + `calendar/page.tsx`；`AppShell` 加侧栏入口。**
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/calendar/useEvents.test.ts` → PASS。`npx tsc --noEmit`。手测：月/周/日切换、新建、编辑、删除、转日程来源邮件回链显示。
- [ ] **Step 5: Commit + push**

```bash
git add src/app/calendar/ src/components/calendar/ src/components/nav/AppShell.tsx src/__tests__/calendar/useEvents.test.ts
git commit -m "feat(calendar): month/week/day views + event editor + useEvents hook + sidebar entry + lazy reminder start"
git push
```

---

### Task 7: `.ics` 生成/解析（P2 预留，最小实现 + 接口固化）

**Files:**
- Create: `src/lib/calendar/ics.ts`
- Test: `src/__tests__/calendar/ics.test.ts`

**关键设计（P2 范围声明）：** 本期只实现**最小可用的 `.ics` 序列化 + 基础解析**，固化接口供 plan-16 后续 P2（会议邀请发送 + 接收侧解析建事件）平滑接入；**不引第三方 ics 库**，不处理 VTIMEZONE 块、RRULE 重复、RSVP。会议邀请发送（.ics 附件）+ 接收侧解析建事件属 P2，本任务不接 UI。
- `toIcs(event): string` — 生成单 `VCALENDAR`/`VEVENT`：`DTSTART`/`DTEND`（all_day 用 `VALUE=DATE` 的 `YYYYMMDD`，否则 UTC `YYYYMMDDTHHMMSSZ`）、`SUMMARY`、`LOCATION`、`DESCRIPTION`（行折行 RFC5545：75 字符折行 + 空格续行）、`UID`（用 `event.id + '@actbox.local'`）、`DTSTAMP`。
- `parseIcs(text): ParsedEvent[]` — 仅解析 `VEVENT` 的 `SUMMARY/DTSTART/DTEND/LOCATION/DESCRIPTION/UID`；不识别的属性忽略；返回供 P2 建 events 行的草稿数组（`{ title, startsAt(ms), endsAt?, location?, description?, sourceMessageId: uid }`）。

- [ ] **Step 1: 写 ics 失败测试**

```ts
// src/__tests__/calendar/ics.test.ts
import { describe, it, expect } from 'vitest'
import { toIcs, parseIcs } from '@/lib/calendar/ics'

describe('toIcs', () => {
  it('all_day 事件用 VALUE=DATE', () => {
    const s = toIcs({ id: 7, title: '全天', startsAt: Date.UTC(2026,5,16,16,0), endsAt: Date.UTC(2026,5,17,16,0), allDay: true })
    expect(s).toContain('BEGIN:VEVENT')
    expect(s).toContain('DTSTART;VALUE=DATE:20260617')
    expect(s).toContain('SUMMARY:全天')
    expect(s).toContain('UID:7@actbox.local')
  })
  it('定时事件 DTSTART 用 UTC YYYYMMDDTHHMMSSZ', () => {
    const s = toIcs({ id: 1, title: '周会', startsAt: Date.UTC(2026,5,17,1,0), endsAt: Date.UTC(2026,5,17,2,0), allDay: false })
    expect(s).toContain('DTSTART:20260617T010000Z')
  })
  it('长描述按 75 字符折行续行加空格', () => {
    const s = toIcs({ id: 1, title: 'x', startsAt: 0, allDay: false, description: 'a'.repeat(80) })
    expect(s).toMatch(/DESCRIPTION:.*\r\n /)         // 折行 + 空格续行
  })
})

describe('parseIcs', () => {
  it('解析 VEVENT 核心字段 → 草稿', () => {
    const text = toIcs({ id: 3, title: '评审', startsAt: Date.UTC(2026,5,17,1,0), endsAt: Date.UTC(2026,5,17,2,0), location: 'A', description: 'd', allDay: false })
    const [e] = parseIcs(text)
    expect(e.title).toBe('评审')
    expect(e.startsAt).toBe(Date.UTC(2026,5,17,1,0))
    expect(e.sourceMessageId).toBe('3@actbox.local')
  })
  it('无 VEVENT 返回空数组', () => {
    expect(parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/calendar/ics.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/lib/calendar/ics.ts`**：`toIcs`（含折行）+ `parseIcs`（按行扫描 + 折行重组 + 字段映射）。**不引依赖**。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/calendar/ics.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/calendar/ics.ts src/__tests__/calendar/ics.test.ts
git commit -m "feat(calendar): minimal .ics serialize/parse (RFC5545 fold, DATE vs DATETIME, UID) - P2 invite groundwork"
git push
```

---

### Task 8: 全量回归 + 收尾

**Files:** 无新文件

- [ ] **Step 1: `npx vitest run`（全量）** → 全绿（含本计划 grid/reminder/ics/convert/events/events-from-mail/useEvents + 既有 todo/messages 等不破坏）。
- [ ] **Step 2: `npx tsc --noEmit` → 无类型错误。**
- [ ] **Step 3: 手测清单**：① 日历侧栏入口可达；② 月/周/日三视图切换 + 游标翻页；③ 新建/编辑/删除事件落库且刷新；④ 全天事件跨日显示；⑤ 邮件「转日程」→ 编辑器预填主题 + 来源邮件回链；⑥ 邮件「转任务」→ todo 列表出现且 source 关联；⑦ 到点提醒（把事件 `startsAt` 设为 1 分钟后、`reminderMinutes=0`）经 EventBus → 桌面通知弹出 + `reminded_at` 被写。
- [ ] **Step 4: Commit + push（若有收尾改动）**

```bash
git add -A
git commit -m "test(calendar): full regression green + manual checklist verified"
git push
```

---

## 验收标准

- [ ] **events 表**：DDL 与 spec §16 一致（id/account_id/title/starts_at/ends_at/all_day/location/description/reminder_minutes/source_message_id/created_at + 本计划补 `reminded_at` 用于提醒去重）；`starts_at`/`ends_at` 存 UTC 毫秒整数；空库冷启动建表、存量库幂等补表。
- [ ] **日/周/月视图**：月格 6×7 正确（`weekStartsOn` 可配）、周/日区间 24h/168h、跨天事件在相交格/列均显示；新建/编辑/删除生效且落库 + 刷新。
- [ ] **提醒**：`dueReminders` 纯函数正确（`reminderMinutes=null` 不提醒 / `fireAt<=now 且 remindedAt=null` 触发 / 已提醒跳过 / 未到跳过）；`ReminderScheduler` 每分钟 tick → 查库 → `eventBus.publish({ type:'calendar-reminder' })` → 置 `reminded_at` 去重；桌面通知由 plan-06 `Notifications.tsx` 弹（不重造通知）。
- [ ] **邮件转日程/转任务**：`mailToEventDraft`/`mailToTodoDraft` 纯映射正确；`POST /api/events/from-mail` 返回草稿（邮件不存在 404）；邮件详情页两个入口可用；转任务复用现有 `POST /api/todos` + todo-email linking（`source_message_id`），不动 todo 表/路由。
- [ ] **.ics（P2 最小）**：`toIcs` all_day 用 `VALUE=DATE`、定时用 `YYYYMMDDTHHMMSSZ`、`UID`/`SUMMARY`/折行正确；`parseIcs` 解析核心字段为草稿、无 VEVENT 返回空。
- [ ] `npm test` 全绿（calendar/{grid,reminder,ics,convert,useEvents}、api/{events,events-from-mail}、db/calendar-schema）。
- [ ] `npx tsc --noEmit` 无类型错误。

---

## 依赖

- **子项目 2（多账号 + accounts 表）**：邮件转日程的 `events.account_id` 取邮件所属账号；accounts 表未落地时 `account_id` 允许 NULL（不强外键）。
- **子项目 6（实时性与通知）**：`src/lib/events/eventBus.ts`（`publish({ type, payload })` + seq）+ `src/components/realtime/Notifications.tsx`（Notification API 桌面通知）—— 提醒经此推送，本计划不重写。若 plan-06 未落地，`ReminderScheduler` 降级 `console.warn`（不崩，但桌面通知不可用，标注缺口）。
- **子项目 8 / 现有（todo-email linking）**：`todos.source_message_id`/`source_subject`/`source_from` + `POST /api/todos` + `GET/PATCH/DELETE /api/todos/[id]`（转任务复用，不重造）。
- **plan-15（i18n + 时区）**：`settings.timezone`（默认 `Asia/Shanghai`）+ `settings.locale`（默认 `zh-CN`）+ `Intl.DateTimeFormat` 本地化显示；未落地时硬编码这两个默认值。
- **现有**：`src/lib/db/{schema.ts,index.ts}`（`getDb()`/`autoCreateTables`）、`src/lib/refresh-bus.ts`（`emitRefresh` 刷新计数）、`src/app/api/todos/*`、`src/app/mails/[id]/page.tsx`（加转日程/转任务按钮）、`src/components/nav/AppShell.tsx`（加日历入口）、`node-cron`（已在依赖）。
- **新依赖**：无强制新增（网格用 `Date`/`Intl`，.ics 手写，提醒用 node-cron）。

---

## 风险

- **plan-06 未落地（EventBus/Notifications 缺失）**：提醒推送无处可发。**缓解**：`ReminderScheduler` 的 `publish` 注入式（默认绑定 eventBus，不存在则降级 `console.warn`），`dueReminders`/`runOnce` 纯逻辑仍可单测全绿；待 plan-06 落地后零改动接入。
- **时区/夏令时换算错误**：手写 UTC↔本地换算易在 DST 边界出错。**缓解**：换算统一用 `Intl.DateTimeFormat(tz, { hourCycle:'h23', ...各分量 })` 读本地分量再 `Date.UTC`（非 `getTimezoneOffset` 手算）；all_day 存「本地 00:00 的 UTC ms」并在 grid 测试覆盖 6 月（CST 无 DST）用例；若用户改 `settings.timezone` 到有 DST 区，后续补 DST 专项测试（P2）。
- **存量库 events 表补建失败**：plan-01 迁移框架若未生效，`autoCreateTables` 首建判据（todos 表已存在）会跳过整段建表分支 → events 表不建。**缓解**：在 `autoCreateTables` **末尾**追加**独立**幂等 `CREATE TABLE IF NOT EXISTS events`（不嵌在 todos 判据分支内），每次启动安全补建（与 plan-15 `tableExists` 探测约定一致）。
- **messages 表无 `account_id` 列（plan-01 未完成）**：from-mail 端点取邮件账号失败。**缓解**：查列存在性，缺失时 `accountId` 返回 null（不崩），事件仍可建（`account_id` 允许 NULL）。
- **提醒 tick 漏触发（进程重启 + 提醒窗口已过）**：事件 `startsAt` 在进程停机期间过去，重启后 `fireAt<=now` 仍会触发一次（`remindedAt=null`）——属可接受（迟到提醒总比漏掉好）；但若停机跨越且事件 `endsAt` 已远过，可加「过期超 N 分钟不再提醒」裁剪（P2）。
- **`.ics` 最小实现兼容性**：不处理 VTIMEZONE/RRULE/RSVP，发给 Outlook/Google 可能被降级解析。**缓解**：属 P2 预留接口；P2 真做会议邀请时按需引 `ical.js` 或补 VTIMEZONE 块（本计划接口签名不变）。
- **视图组件复杂度**：Week/DayView 时段绝对定位 + 拖选易出 UI bug。**缓解**：P1 先做点击新建（非拖选），拖选/resize 列 P2；纯逻辑（网格/区间/筛选/换算）全单测覆盖，UI 手测验收。

---

## P2（预留，不在本期实现）

- **会议邀请发送**：ComposeMail 侧「插入会议邀请」→ 用 Task 7 的 `toIcs` 生成 `.ics` 作为附件（`Content-Type: text/calendar`）经 plan-04 附件链路发出 + `METHOD:REQUEST`；RSVP 回执解析（`REPLY`）。
- **接收侧解析 `.ics` 建事件**：plan-04 附件接收后，识别 `text/calendar` 附件 → 调 `parseIcs` → 建 events 行（`source_message_id` = uid）；邮件详情页「加入日历」一键。
- **通知中心**：集中日历提醒、任务到期（todo `due_date` 到期）、新邮件分级提醒（plan-06 分级）——统一通知中心页 + 已读/忽略；本计划已发 `calendar-reminder` 事件，通知中心作为聚合消费方（P2）。
- **CalDAV / Exchange 日历同步**：预留 `CalendarAdapter` 接口（`listCalendars/listEvents/createEvent/updateEvent/deleteEvent`），CalDAV 用 `tsdav`/手写 CalDAV client，Exchange 用 EWS；`events` 表加 `calendar_id`/`remote_uid`/`etag` 列做双向同步 + 冲突解决（参考 plan-03 IMAP UID 模式）。本地日历（`calendar_id=NULL`）为默认实现，远端同步为可选 adapter。
- **重复事件 RRULE**：`events` 加 `rrule`（RFC5545）+ 展开器（`rrule.js`）；视图对重复事件虚展开。
- **多日历分组/颜色**：`calendars` 表（id/name/color）+ `events.calendar_id`，视图按日历着色筛选。
- **拖拽改期 / resize 改时长**（Week/DayView 直接拖事件块）、**迷你月历导航**、**议程视图**、**全天事件跨天合并显示**。
- **时区切换 UI**（在 settings 暴露 `timezone` 选择 + 日历视图显示当前时区）。
