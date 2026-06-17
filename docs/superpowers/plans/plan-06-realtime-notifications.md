# 子项目 6 — 实时性与通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把"60s 客户端轮询 + 30min cron fetch"升级为秒级实时——每活跃账号维持一条 IMAP IDLE 长连接收到 EXISTS 秒级触发拉取；服务端 SSE 通道 `/api/events` 推新邮件/未读数/状态变更（断线重连 + 状态追赶 + 事件幂等 + 多标签页连接复用）；Notification API 桌面/浏览器通知（按账号/文件夹分级、声音、角标，需授权）；已读/移动/标星经 UID 增量同步 <10s。

**Architecture:** 方案 B（详见 spec §0/子项目 6/NFR "SSE 可靠性"/"性能"/"冲突解决"）。本地单机、Next.js 进程内长连接（**非 Serverless**）。三层：(1) `ImapIdleSupervisor` 每活跃账号一条 ImapFlow `idle()` 长连接，收到 EXISTS 即拉取入库并经 EventBus 发事件，29min 打断重 SELECT 续命避开 30min IMAP 超时，断线指数退避重连，连续失败标 `sync_status=error` 自动降级为 node-cron 短间隔轮询；(2) 进程内 `eventBus.ts`（升级自 `refresh-bus.ts`）做发布订阅，作为 SSE 事件源 + 客户端广播桥；(3) `/api/events` SSE handler 把 EventBus 事件以 `text/event-stream` 推客户端，带单调递增 `seq`（状态追赶：客户端 `Last-Event-ID` 起补发 buffered 事件）+ 事件去重（`id` 幂等）+ 多标签页 `BroadcastChannel` 连接复用。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / ImapFlow / better-sqlite3(WAL) / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 1（messages `account_id/folder/imap_uid` 列 + jobs 队列表）、子项目 2（`MailAdapter`/`AccountConfig`/`getAdapter(accountId)`/accounts 表 `sync_mode/sync_status`）、子项目 3（`folders` 表 + `applyAction` UID 回写）。阶段 1 执行——每任务先写失败测试再实现（TDD 微步骤，先红后绿）。

---

## 文件结构

- Create: `src/lib/events/eventBus.ts` — 进程内发布订阅（升级自 `refresh-bus.ts`），SSE 事件源
- Create: `src/lib/events/types.ts` — `MailEvent` 联合类型 + `EventEnvelope(seq, type, payload)`
- Modify: `src/lib/refresh-bus.ts` — 退化为 eventBus 的薄封装（保留 `emitRefresh/onRefresh` 导出兼容旧调用方）
- Create: `src/lib/realtime/imapIdleSupervisor.ts` — 每账号 IDLE 长连接管理（idle/续命/重连/降级）
- Create: `src/lib/realtime/incrementalSync.ts` — EXISTS 触发的增量拉取（复用 plan-03 的 UID 回写与 uidvalidity）
- Create: `src/lib/realtime/fallbackPoller.ts` — 不健康账号降级轮询（node-cron 短间隔）
- Modify: `src/lib/sync/writeback.ts` — `applyAction` 成功后 `eventBus.publish`（<10s 状态变更感知）
- Create: `src/app/api/events/route.ts` — SSE handler（text/event-stream + Last-Event-ID 状态追赶）
- Create: `src/components/realtime/useMailEvents.ts` — 客户端 hook：SSE + 自动重连 + BroadcastChannel 多标签页复用
- Modify: `src/app/page.tsx`（或 `src/components/nav/AppShell.tsx`）— 挂载 `useMailEvents` 替代 60s `setInterval` 轮询
- Create: `src/components/realtime/Notifications.tsx` — Notification API 桌面通知（分级/声音/角标/授权）
- Create: `src/lib/realtime/health.ts` — 账号健康判定 + 降级/恢复决策
- Test: `src/__tests__/events/eventBus.test.ts`、`src/__tests__/realtime/imapIdleSupervisor.test.ts`、`src/__tests__/realtime/incrementalSync.test.ts`、`src/__tests__/realtime/health.test.ts`、`src/__tests__/api/events.test.ts`、`src/__tests__/realtime/useMailEvents.test.ts`

---

## 任务

### Task 1: EventBus + MailEvent 类型（升级 refresh-bus）

**Files:**
- Create: `src/lib/events/types.ts`
- Create: `src/lib/events/eventBus.ts`
- Modify: `src/lib/refresh-bus.ts`
- Test: `src/__tests__/events/eventBus.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { eventBus } from '@/lib/events/eventBus'
import type { MailEvent, EventEnvelope } from '@/lib/events/types'

describe('eventBus 进程内发布订阅', () => {
  it('subscribe 收到 publish 的事件 + 单调递增 seq', () => {
    const seen: EventEnvelope[] = []
    eventBus.subscribe((e) => seen.push(e))
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'm1', accountId: 1, folder: 'INBOX' } })
    eventBus.publish({ type: 'unread-count', payload: { accountId: 1, folder: 'INBOX', unread: 3 } })
    expect(seen.map((e) => e.seq)).toEqual([1, 2])
    expect(seen[0]).toMatchObject({ type: 'new-mail', payload: { messageId: 'm1' } })
  })

  it('subscribe 返回 unsubscribe，取消后不再收', () => {
    const fn = vi.fn()
    const off = eventBus.subscribe(fn)
    eventBus.publish({ type: 'status', payload: { accountId: 1, status: 'syncing' } })
    off()
    eventBus.publish({ type: 'status', payload: { accountId: 1, status: 'healthy' } })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('since(seq) 返回已 buffer 的事件（状态追赶）', () => {
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'a', accountId: 1, folder: 'INBOX' } })
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'b', accountId: 1, folder: 'INBOX' } })
    const last = eventBus.lastSeq()
    const missed = eventBus.since(last - 1)
    expect(missed.map((e) => (e.payload as any).messageId)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/events/eventBus.test.ts` → FAIL。

- [ ] **Step 3: 实现 types.ts**

```ts
// src/lib/events/types.ts
export type MailEvent =
  | { type: 'new-mail'; payload: { messageId: string; accountId: number; folder: string; subject: string | null; from: string | null } }
  | { type: 'unread-count'; payload: { accountId: number; folder: string; unread: number; total: number } }
  | { type: 'message-updated'; payload: { messageId: string; accountId: number; folder: string; changes: { isRead?: boolean; isStarred?: boolean; folder?: string } } }
  | { type: 'status'; payload: { accountId: number; status: 'healthy' | 'syncing' | 'error' | 'disabled'; error?: string } }

export interface EventEnvelope {
  seq: number        // 单调递增，作 SSE event id（状态追赶 + 幂等去重键）
  type: MailEvent['type']
  payload: MailEvent['payload']
  id: string         // 业务幂等键（new-mail=messageId, unread-count=accountId:folder:unread, …）客户端去重
  ts: number
}
```

- [ ] **Step 4: 实现 eventBus.ts**

```ts
// src/lib/events/eventBus.ts
import type { EventEnvelope, MailEvent } from './types'

type Subscriber = (e: EventEnvelope) => void

class EventBus {
  private subscribers = new Set<Subscriber>()
  private seq = 0
  private buffer: EventEnvelope[] = []   // 环形缓冲，状态追赶用（保留最近 N 条，N=500）
  private readonly BUFFER_MAX = 500

  publish(ev: MailEvent): EventEnvelope {
    const envelope: EventEnvelope = {
      seq: ++this.seq,
      type: ev.type,
      payload: ev.payload,
      id: idFor(ev),
      ts: Date.now(),
    }
    this.buffer.push(envelope)
    if (this.buffer.length > this.BUFFER_MAX) this.buffer.splice(0, this.buffer.length - this.BUFFER_MAX)
    for (const s of this.subscribers) {
      try { s(envelope) } catch { /* 单个订阅者失败不影响其他 */ }
    }
    return envelope
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => { this.subscribers.delete(fn) }
  }

  lastSeq(): number { return this.seq }
  since(seq: number): EventEnvelope[] { return this.buffer.filter((e) => e.seq > seq) }
}

function idFor(ev: MailEvent): string {
  switch (ev.type) {
    case 'new-mail': return `new-mail:${ev.payload.messageId}`
    case 'unread-count': return `unread:${ev.payload.accountId}:${ev.payload.folder}:${ev.payload.unread}`
    case 'message-updated': return `upd:${ev.payload.messageId}:${JSON.stringify(ev.payload.changes)}`
    case 'status': return `status:${ev.payload.accountId}:${ev.payload.status}:${ev.payload.ts ?? Date.now()}`
  }
}

export const eventBus = new EventBus()
```

- [ ] **Step 5: 改 refresh-bus.ts 退化为 eventBus 薄封装**（保留旧 API 不破坏现有调用方）

```ts
// src/lib/refresh-bus.ts
import { eventBus } from './events/eventBus'
export function emitRefresh() { eventBus.publish({ type: 'status', payload: { accountId: 0, status: 'healthy' } }) }
export function onRefresh(fn: () => void): () => void {
  return eventBus.subscribe(() => fn())  // 任何事件都触发旧式刷新
}
```

- [ ] **Step 6: 运行确认通过**：`npx vitest run src/__tests__/events/eventBus.test.ts` → PASS。`npx tsc --noEmit` 无错。

- [ ] **Step 7: Commit**

```bash
git add src/lib/events/ src/lib/refresh-bus.ts src/__tests__/events/eventBus.test.ts
git commit -m "feat(events): in-process EventBus with seq + buffer (upgrades refresh-bus)"
git push
```

---

### Task 2: ImapIdleSupervisor — IDLE 长连接 + 29min 续命 + 退避重连 + 降级

**Files:**
- Create: `src/lib/realtime/imapIdleSupervisor.ts`
- Test: `src/__tests__/realtime/imapIdleSupervisor.test.ts`

- [ ] **Step 1: 写失败测试**（mock ImapFlow client，注入定时器）

```ts
import { describe, it, expect, vi } from 'vitest'
import { ImapIdleSupervisor } from '@/lib/realtime/imapIdleSupervisor'

describe('ImapIdleSupervisor', () => {
  it('start 后对 INBOX 调 idle 并监听 mail 事件', async () => {
    const idle = vi.fn().mockImplementation(async ({ onMail }) => { (onMail as any).__fire = onMail })
    const client = { connect: vi.fn().mockResolvedValue(undefined), mailboxOpen: vi.fn().mockResolvedValue({}), idle, logout: vi.fn().mockResolvedValue(undefined) } as any
    const onNewMail = vi.fn()
    const sup = new ImapIdleSupervisor({ accountId: 1, clientFactory: async () => client, folder: 'INBOX', onNewMail, clock: fakeClock() })
    await sup.start()
    expect(client.mailboxOpen).toHaveBeenCalledWith('INBOX')
    expect(idle).toHaveBeenCalled()
    // 模拟服务器 EXISTS
    ;(idle.mock.calls[0][0] as any).onMail()
    expect(onNewMail).toHaveBeenCalledWith({ accountId: 1, folder: 'INBOX' })
    await sup.stop()
    expect(client.logout).toHaveBeenCalled()
  })

  it('29min 打断 idle 重 SELECT 续命（避开 30min 超时）', async () => {
    const clk = fakeClock()
    const idleCtrl = mkIdleCtrl()
    const client = mkClient(idleCtrl)
    const sup = new ImapIdleSupervisor({ accountId: 1, clientFactory: async () => client, folder: 'INBOX', onNewMail: () => {}, clock: clk })
    await sup.start()
    expect(idleCtrl.calls).toBe(1)
    clk.advance(29 * 60 * 1000)
    await clk.flush()
    expect(idleCtrl.calls).toBe(2) // 续命：重新 idle
    await sup.stop()
  })

  it('断线指数退避重连（1s/2s/4s…封顶 60s）', async () => {
    const clk = fakeClock()
    const connect = vi.fn().mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net')).mockResolvedValue(undefined)
    const client = mkClient(mkIdleCtrl(), { connect })
    const sup = new ImapIdleSupervisor({ accountId: 1, clientFactory: async () => client, folder: 'INBOX', onNewMail: () => {}, clock: clk })
    await sup.start()
    expect(connect).toHaveBeenCalledTimes(1)
    clk.advance(1000); await clk.flush()  // 第一次退避 1s
    expect(connect).toHaveBeenCalledTimes(2)
    clk.advance(2000); await clk.flush()  // 第二次 2s
    expect(connect).toHaveBeenCalledTimes(3) // 第三次连上
    await sup.stop()
  })

  it('连续失败超阈值 → 降级（onDegraded 被调，停止重连）', async () => {
    const clk = fakeClock()
    const connect = vi.fn().mockRejectedValue(new Error('auth fail'))
    const client = mkClient(mkIdleCtrl(), { connect })
    const onDegraded = vi.fn()
    const sup = new ImapIdleSupervisor({ accountId: 1, clientFactory: async () => client, folder: 'INBOX', onNewMail: () => {}, onDegraded, clock: clk, maxFailures: 3, maxBackoffMs: 4000 })
    await sup.start()
    for (const d of [1000, 2000, 4000]) { clk.advance(d); await clk.flush() }
    expect(connect).toHaveBeenCalledTimes(3)
    expect(onDegraded).toHaveBeenCalledWith({ accountId: 1, reason: 'auth fail', attempts: 3 })
    expect(sup.state).toBe('degraded')
  })
})
```

（`fakeClock`/`mkIdleCtrl`/`mkClient` 为测试辅助：注入 `setTimeout`/`Date.now`，提供可控 idle 回调。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/realtime/imapIdleSupervisor.test.ts` → FAIL。

- [ ] **Step 3: 实现 ImapIdleSupervisor**（关键真实代码）

```ts
// src/lib/realtime/imapIdleSupervisor.ts
export interface IdleOptions {
  accountId: number
  clientFactory: () => Promise<ImapFlowLike>
  folder: string
  onNewMail: (e: { accountId: number; folder: string }) => void
  onDegraded?: (e: { accountId: number; reason: string; attempts: number }) => void
  clock?: { now(): number; setTimeout(fn: () => void, ms: number): () => void; clearTimeout(h: unknown): void }
  keepaliveMs?: number       // 默认 29min
  maxFailures?: number       // 默认 5
  maxBackoffMs?: number      // 默认 60_000
}

type State = 'idle' | 'reconnecting' | 'degraded' | 'stopped'

export class ImapIdleSupervisor {
  state: State = 'stopped'
  private client: ImapFlowLike | null = null
  private failures = 0
  private lock: { locked: boolean; req: (() => void) | null } = { locked: false, req: null }
  private readonly clock: Clock
  private readonly keepaliveMs: number
  private readonly maxFailures: number
  private readonly maxBackoffMs: number
  private keepaliveHandle: unknown = null
  private reconnectHandle: unknown = null

  constructor(private opts: IdleOptions) {
    this.clock = opts.clock ?? realClock
    this.keepaliveMs = opts.keepaliveMs ?? 29 * 60 * 1000   // 29min 续命避开 30min 超时
    this.maxFailures = opts.maxFailures ?? 5
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000
  }

  async start(): Promise<void> {
    await this.runLoop()
  }

  private async runLoop(): Promise<void> {
    while (this.state !== 'stopped' && this.state !== 'degraded') {
      try {
        this.client = await this.opts.clientFactory()
        await this.client.mailboxOpen(this.opts.folder)
        this.failures = 0
        this.state = 'idle'
        this.armKeepalive()
        // idle() 阻塞直到被打断（keepalive 触发 logout+reopen）或连接断开
        await this.client.idle({
          onMail: () => this.opts.onNewMail({ accountId: this.opts.accountId, folder: this.opts.folder }),
        })
        this.disarmKeepalive()
        // idle 正常返回（被打断续命或断线）→ 走重连流程
        await this.client.logout().catch(() => {})
      } catch (err) {
        this.disarmKeepalive()
        this.failures += 1
        if (this.failures >= this.maxFailures) {
          this.state = 'degraded'
          this.opts.onDegraded?.({ accountId: this.opts.accountId, reason: String((err as Error)?.message ?? err), attempts: this.failures })
          return
        }
        this.state = 'reconnecting'
        const backoff = Math.min(this.maxBackoffMs, 1000 * 2 ** (this.failures - 1))  // 1s/2s/4s…封顶
        await this.sleep(backoff)
      }
    }
  }

  private armKeepalive(): void {
    this.disarmKeepalive()
    this.keepaliveHandle = this.clock.setTimeout(() => { void this.keepalive() }, this.keepaliveMs)
  }
  private disarmKeepalive(): void {
    if (this.keepaliveHandle) { this.clock.clearTimeout(this.keepaliveHandle); this.keepaliveHandle = null }
  }
  // 29min 续命：logout 当前 idle → runLoop 重新 connect+SELECT+idle
  private async keepalive(): Promise<void> { try { await this.client?.logout() } catch {} }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { this.reconnectHandle = this.clock.setTimeout(resolve, ms) })
  }

  async stop(): Promise<void> {
    this.state = 'stopped'
    this.disarmKeepalive()
    if (this.reconnectHandle) this.clock.clearTimeout(this.reconnectHandle)
    try { await this.client?.logout() } catch {}
  }
}
```

接口 `ImapFlowLike`：`{ connect(); mailboxOpen(path); idle(opts:{onMail}): Promise<void>; logout(): Promise<void> }`（ImapFlow 的 `idle()` 真实签名即 `{ onMail, onClose, onError }`，收到 EXISTS 调 `onMail`）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/realtime/imapIdleSupervisor.test.ts` → PASS。`npx tsc --noEmit` 无错。

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/imapIdleSupervisor.ts src/__tests__/realtime/imapIdleSupervisor.test.ts
git commit -m "feat(realtime): ImapIdleSupervisor - IDLE keepalive(29m) + backoff + degrade"
git push
```

---

### Task 3: 增量拉取 incrementalSync（EXISTS → UID 增量 → 入库 → 发事件）

**Files:**
- Create: `src/lib/realtime/incrementalSync.ts`
- Test: `src/__tests__/realtime/incrementalSync.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { pullIncremental } from '@/lib/realtime/incrementalSync'

describe('pullIncremental EXISTS 触发增量', () => {
  it('拉取 folder 内 since-last-uid 的新邮件，入库并 publish new-mail/unread-count', async () => {
    const adapter = {
      fetch: vi.fn().mockResolvedValue([
        { messageId: '<m1>', subject: 's1', from: 'a@x', body: '', bodyHtml: null, receivedAt: new Date(), imapUid: 30 },
      ]),
    } as any
    const db = memDb()
    // 记录上次同步的高水位 uid
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('uidhigh:1:INBOX', '29')
    const publish = vi.fn()
    const r = await pullIncremental(db, { accountId: 1, folder: 'INBOX', adapter, publish })
    expect(adapter.fetch).toHaveBeenCalledWith(expect.objectContaining({ folder: 'INBOX', uidRange: [30, null] }))
    expect(r.inserted).toBe(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'new-mail', payload: expect.objectContaining({ messageId: '<m1>', accountId: 1, folder: 'INBOX' }) }))
    // 高水位更新到 30
    expect(db.prepare('SELECT value FROM settings WHERE key=?').get('uidhigh:1:INBOX')).toMatchObject({ value: '30' })
  })

  it('UIDVALIDITY 变化 → 复用 plan-03 checkUidValidity 重新映射（不重复入库）', async () => {
    // 注入 fake adapter 返回新 uid，断言旧 uid 被清后重映射，无重复行
    const adapter = { fetch: vi.fn().mockResolvedValue([{ messageId: '<m1>', subject: 's', from: 'a', body: '', bodyHtml: null, receivedAt: new Date(), imapUid: 5 }]) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, direction) VALUES ('<m1>',1,'INBOX',10,'in')`)
    // mock uidvalidity 变化
    const r = await pullIncremental(db, { accountId: 1, folder: 'INBOX', adapter, publish: () => {}, uidValidity: 999 })
    expect(db.prepare('SELECT count(*) c FROM messages WHERE account_id=1 AND folder=?').get('INBOX')).toMatchObject({ c: 1 }) // 不重复
    expect(r.inserted).toBeGreaterThanOrEqual(1)
  })

  it('无新邮件不 publish', async () => {
    const adapter = { fetch: vi.fn().mockResolvedValue([]) } as any
    const publish = vi.fn()
    const r = await pullIncremental(memDb(), { accountId: 1, folder: 'INBOX', adapter, publish })
    expect(r.inserted).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/realtime/incrementalSync.test.ts` → FAIL。

- [ ] **Step 3: 实现 pullIncremental**

```ts
// src/lib/realtime/incrementalSync.ts
import type { MailAdapter } from '@/lib/adapter/types'
import { checkUidValidity } from '@/lib/sync/uidvalidity'   // plan-03
import { upsertMessage, lastUidHighWater, setUidHighWater, recomputeUnread } from '@/lib/messages/repo'

export async function pullIncremental(db: DB, opts: {
  accountId: number; folder: string; adapter: MailAdapter
  publish: (ev: MailEvent) => void
  uidValidity?: number
}): Promise<{ inserted: number }> {
  const { accountId, folder, adapter, publish } = opts

  // 1. UIDVALIDITY 变化 → plan-03 重映射（清旧 imap_uid 防重复入库）
  if (opts.uidValidity != null) {
    const v = checkUidValidity(db, { accountId, folder, uidValidity: opts.uidValidity })
    if (v.mustRemap) { /* 上层重拉，这里继续以增量 fetch + 重新分配 uid */ }
  }

  // 2. 取高水位 uid，fetch uidRange: [last+1, null]（仅新邮件）
  const last = lastUidHighWater(db, { accountId, folder })   // settings KV uidhigh:{acc}:{folder}
  const since = last != null ? last + 1 : 1
  const raws = await adapter.fetch({ folder, uidRange: [since, null as unknown as number] })

  // 3. 入库 + 更新高水位（取 max uid）+ 发事件
  let maxUid = last ?? 0
  let inserted = 0
  for (const raw of raws) {
    if (!raw.imapUid) continue
    upsertMessage(db, { ...raw, accountId, folder })
    maxUid = Math.max(maxUid, raw.imapUid)
    inserted++
    publish({ type: 'new-mail', payload: { messageId: raw.messageId, accountId, folder, subject: raw.subject, from: raw.from } })
  }
  if (inserted > 0) setUidHighWater(db, { accountId, folder, uid: maxUid })

  // 4. 重算未读角标 + publish
  const u = recomputeUnread(db, { accountId, folder })
  if (inserted > 0) publish({ type: 'unread-count', payload: { accountId, folder, unread: u.unread, total: u.total } })

  return { inserted }
}
```

（`uidRange: [since, null]` 表示"from since 到最大"；`MailAdapter.fetch` 的 `uidRange?: [number, number]` 在 plan-02/plan-03 已定义，null 上界由 ImapAdapter 翻译为 `{ gte: since }`。）

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/realtime/incrementalSync.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/incrementalSync.ts src/__tests__/realtime/incrementalSync.test.ts
git commit -m "feat(realtime): incremental pull on EXISTS -> UID range -> publish events"
git push
```

---

### Task 4: 账号健康判定 + 降级轮询 fallbackPoller

**Files:**
- Create: `src/lib/realtime/health.ts`
- Create: `src/lib/realtime/fallbackPoller.ts`
- Test: `src/__tests__/realtime/health.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { markDegraded, markHealthy, shouldPoll } from '@/lib/realtime/health'

describe('账号健康/降级决策', () => {
  it('markDegraded 写 accounts.sync_status=error', () => {
    const db = memDb(); db.exec(`INSERT INTO accounts(id,email,provider,protocol,sync_mode,sync_status,user,auth_code) VALUES(1,'a@b','163','imap','idle','healthy','u','p')`)
    markDegraded(db, { accountId: 1, error: 'auth fail' })
    const row = db.prepare('SELECT sync_status,sync_error FROM accounts WHERE id=1').get() as any
    expect(row.sync_status).toBe('error')
    expect(row.sync_error).toBe('auth fail')
  })
  it('shouldPoll: error 状态 → 短间隔轮询(30s)', () => {
    const db = memDb(); db.exec(`INSERT INTO accounts(id,email,provider,protocol,sync_mode,sync_status,user,auth_code) VALUES(1,'a','163','imap','error','u','p')`)
    expect(shouldPoll(db, 1)).toEqual({ poll: true, intervalSec: 30 })
  })
  it('shouldPoll: healthy + sync_mode=idle → 不轮询(走 IDLE)', () => {
    const db = memDb(); db.exec(`INSERT INTO accounts(id,email,provider,protocol,sync_mode,sync_status,user,auth_code) VALUES(1,'a','163','imap','idle','healthy','u','p')`)
    expect(shouldPoll(db, 1)).toEqual({ poll: false })
  })
  it('markHealthy 恢复 → shouldPoll false（恢复 IDLE 由 supervisor 监听 accounts 变更重启）', () => {
    const db = memDb(); db.exec(`INSERT INTO accounts(id,email,provider,protocol,sync_mode,sync_status,user,auth_code) VALUES(1,'a','163','imap','error','u','p')`)
    markHealthy(db, 1)
    expect(shouldPoll(db, 1)).toEqual({ poll: false })
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/realtime/health.test.ts` → FAIL。

- [ ] **Step 3: 实现 health.ts**：`markDegraded` 写 `accounts.sync_status='error'` + `sync_error`；`markHealthy` 写 `'healthy'` + 清 error；`shouldPoll(db, accountId)` 返回 `{poll, intervalSec}`——`sync_status==='error'` 或 `sync_mode==='poll'` → `{poll:true, intervalSec: sync_mode==='poll'? 60 : 30}`，否则 `{poll:false}`。实现 `fallbackPoller`：用 node-cron 每 30s 对所有 `shouldPoll().poll===true` 的账号跑 `pullIncremental`（降级路径，IDLE supervisor 失败后接管）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/realtime/health.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/health.ts src/lib/realtime/fallbackPoller.ts src/__tests__/realtime/health.test.ts
git commit -m "feat(realtime): account health + degraded fallback poller (30s)"
git push
```

---

### Task 5: SSE handler `/api/events`（状态追赶 + 幂等 + 多标签页复用提示）

**Files:**
- Create: `src/app/api/events/route.ts`
- Test: `src/__tests__/api/events.test.ts`

- [ ] **Step 1: 写失败测试**（断言 SSE 流格式 + Last-Event-ID 状态追赶）

```ts
import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/events/route'
import { eventBus } from '@/lib/events/eventBus'

describe('GET /api/events SSE', () => {
  it('返回 text/event-stream + 心跳', async () => {
    const req = new Request('http://x/api/events')
    const res = await GET(req)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value!)
    expect(text).toMatch(/event: heartbeat|: keepalive/) // 注释行心跳
    reader.cancel()
  })

  it('Last-Event-ID 触发状态追赶（补发 buffer 中 seq 之后的）', async () => {
    // 先发 2 条进 buffer
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: null, from: null } })
    const last = eventBus.lastSeq()
    const req = new Request('http://x/api/events', { headers: { 'Last-Event-ID': String(last - 1) } })
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value!)
    expect(text).toContain('id: ' + last) // 补发 seq=last 的事件
    expect(text).toContain('new-mail')
    reader.cancel()
  })

  it('publish 后事件以 id: 行 + event: 行 + data: JSON 写出', async () => {
    const req = new Request('http://x/api/events')
    const res = await GET(req)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    eventBus.publish({ type: 'unread-count', payload: { accountId: 1, folder: 'INBOX', unread: 5, total: 9 } })
    const chunks: string[] = []
    let n = 0
    while (n++ < 5) { const { value } = await reader.read(); chunks.push(new TextDecoder().decode(value!)); if (chunks.join('').includes('unread-count')) break }
    const text = chunks.join('')
    expect(text).toMatch(/id: \d+\nevent: unread-count\ndata: \{.*"unread":5.*\}/)
    reader.cancel()
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/api/events.test.ts` → FAIL。

- [ ] **Step 3: 实现 SSE handler**（关键真实代码）

```ts
// src/app/api/events/route.ts
import { eventBus } from '@/lib/events/eventBus'

export const dynamic = 'force-dynamic'          // 禁静态化
export const runtime = 'nodejs'                  // 长连接需 nodejs runtime

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder()
  const lastEventId = Number(req.headers.get('last-event-id') ?? 0)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 状态追赶：补发 buffer 中 seq > lastEventId 的事件
      for (const e of eventBus.since(lastEventId)) {
        controller.enqueue(encoder.encode(formatSSE(e)))
      }
      // 2. 心跳（每 25s，防代理/浏览器空闲断开）
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch {}
      }, 25_000)
      // 3. 订阅实时事件
      const off = eventBus.subscribe((e) => {
        try { controller.enqueue(encoder.encode(formatSSE(e))) } catch {}
      })
      // 4. 清理
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat); off(); controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',   // nginx 不缓冲
    },
  })
}

function formatSSE(e: { seq: number; type: string; payload: unknown; id: string }): string {
  return `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`
}
```

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/api/events.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/events/route.ts src/__tests__/api/events.test.ts
git commit -m "feat(api): SSE /api/events with Last-Event-ID replay + heartbeat"
git push
```

---

### Task 6: 客户端 useMailEvents hook（SSE 自动重连 + BroadcastChannel 多标签页复用 + 去重）

**Files:**
- Create: `src/components/realtime/useMailEvents.ts`
- Test: `src/__tests__/realtime/useMailEvents.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMailEvents } from '@/components/realtime/useMailEvents'

describe('useMailEvents', () => {
  it('收到 new-mail 事件回调，去重（同 messageId 不重复触发）', () => {
    const onNewMail = vi.fn()
    const { result } = renderHook(() => useMailEvents({ onNewMail }))
    act(() => { result.current.__dispatch({ seq: 1, type: 'new-mail', id: 'new-mail:m1', payload: { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: 's', from: 'a' }, ts: 0 }) })
    act(() => { result.current.__dispatch({ seq: 2, type: 'new-mail', id: 'new-mail:m1', payload: { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: 's', from: 'a' }, ts: 0 }) })
    expect(onNewMail).toHaveBeenCalledTimes(1) // 幂等去重
  })
  it('Last-Event-ID 记忆：重连时携带上次 seq', () => {
    const { result, rerender } = renderHook(() => useMailEvents({}))
    act(() => { result.current.__dispatch({ seq: 42, type: 'status', id: 'x', payload: { accountId: 1, status: 'healthy' }, ts: 0 }) })
    rerender()
    expect(result.current.lastEventId).toBe(42)
  })
})
```

（`__dispatch`/`lastEventId` 为测试暴露口，生产路径走真实 EventSource。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/realtime/useMailEvents.test.ts` → FAIL。

- [ ] **Step 3: 实现 useMailEvents**：用 `EventSource('/api/events')` 连接；维护 `lastEventId`（localStorage 持久化 + `lastEventIdRef`，重连时 `EventSource` 自动带 `Last-Event-ID` 头）；`onmessage` 按 `event` 字段分发到 `onNewMail/onUnreadCount/onMessageUpdated/onStatus` 回调；用 `Set<id>` 内存去重窗（保留最近 200 条业务幂等键，重复 `id` 丢弃）。**多标签页复用**：用 `BroadcastChannel('actbox-events')`，首个标签页建立 SSE，后续标签页通过 BroadcastChannel 收同一事件流，避免 N 个 SSE 连接（leader-election：localStorage lock + `storage` 事件 fallback）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/realtime/useMailEvents.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/realtime/useMailEvents.ts src/__tests__/realtime/useMailEvents.test.ts
git commit -m "feat(realtime): useMailEvents - SSE auto-reconnect + dedup + BroadcastChannel fan-out"
git push
```

---

### Task 7: writeback 接 EventBus（状态变更 <10s 感知）

**Files:**
- Modify: `src/lib/sync/writeback.ts`

- [ ] **Step 1: 写失败测试**（扩 plan-03 的 writeback.test.ts，断言 applyAction 成功后 publish `message-updated`）

```ts
it('markRead 成功后 publish message-updated(isRead)', async () => {
  const publish = vi.fn()
  const adapter = { markRead: vi.fn().mockResolvedValue(undefined) } as any
  const db = memDb()
  db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, is_read, direction) VALUES ('<m1>',1,'INBOX',10,0,'in')`)
  await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true, publish })
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({
    type: 'message-updated',
    payload: expect.objectContaining({ messageId: '<m1>', accountId: 1, folder: 'INBOX', changes: { isRead: true } }),
  }))
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/sync/writeback.test.ts` → FAIL（新断言）。

- [ ] **Step 3: 改 applyAction**：签名增可选 `publish?: (ev: MailEvent) => void`；每条 message 成功回写后调 `publish({ type:'message-updated', payload:{ messageId, accountId, folder, changes } })`（markRead→`{isRead}`、star→`{isStarred}`、move→`{folder}`）；批量 move/restore 后再 publish 一次 `unread-count`（收件箱角标实时刷新）。`publish` 缺省时 noop（向后兼容 plan-03 旧测试）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/sync/writeback.test.ts` → PASS（新旧断言全过）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/writeback.ts src/__tests__/sync/writeback.test.ts
git commit -m "feat(sync): applyAction publishes message-updated events (<10s propagation)"
git push
```

---

### Task 8: Supervisor 接线 + AppShell 挂载（替换 60s 轮询）

**Files:**
- Create: `src/lib/realtime/startSupervisors.ts`（Next 进程启动时对每活跃账号起 ImapIdleSupervisor）
- Modify: `src/components/nav/AppShell.tsx`（挂载 useMailEvents 替代 setInterval 轮询）

- [ ] **Step 1: 实现 startSupervisors**：遍历 `accounts where is_active AND sync_mode='idle'`，每账号 `new ImapIdleSupervisor({ accountId, clientFactory: () => makeImapFlow(cfg), folder:'INBOX', onNewMail: ({accountId,folder}) => pullIncremental(db,{accountId,folder,adapter:getAdapter(accountId),publish:e=>eventBus.publish(e)}), onDegraded: ({accountId,reason}) => { markDegraded(db,{accountId,error:reason}); eventBus.publish({type:'status',payload:{accountId,status:'error',error:reason}}) } })`，全局 Map 存活 supervisor 实例；账号增删（plan-02 路由）时 start/stop 对应 supervisor。

- [ ] **Step 2: 改 AppShell**：移除 60s `setInterval` 计数轮询；挂 `useMailEvents({ onNewMail, onUnreadCount: recomputeBadges, onMessageUpdated: patchLocal })`；新邮件增量更新本地列表（不整页刷新）。

- [ ] **Step 3: 手测**：登录一个活跃账号 → supervisor 起 IDLE → 服务器端发一封新邮件 → <30s 客户端出现（无手动刷新）；杀 supervisor 的连接 → 退避重连 → 重连失败到阈值 → 降级轮询（角标 sync_status=error）→ 30s 内仍能收到新邮件。

- [ ] **Step 4: Commit**

```bash
git add src/lib/realtime/startSupervisors.ts src/lib/realtime/fallbackPoller.ts src/components/nav/AppShell.tsx
git commit -m "feat(realtime): wire IDLE supervisors + replace 60s polling with SSE in AppShell"
git push
```

---

### Task 9: Notification API 桌面/浏览器通知（分级 + 声音 + 角标 + 授权）

**Files:**
- Create: `src/components/realtime/Notifications.tsx`

- [ ] **Step 1: 实现 Notifications 组件**
  - 挂载时若 `Notification.permission === 'default'`，UI 提示「开启通知」按钮 → `Notification.requestPermission()`。
  - 订阅 `useMailEvents` 的 `onNewMail`：按账号/文件夹分级（INBOX 默认响 + 桌面通知；垃圾/草稿静默；可配置 `settings.notify_folders`）；`new Notification(title, { body: subject, tag: messageId, icon })`（tag 幂等防重复弹出）。
  - 声音：`new Audio('/sounds/ding.mp3').play()`（静音配置 `settings.notify_sound`）。
  - 角标：`navigator.setAppBadge(unreadTotal)`（支持时）/ document.title 前缀 `(N)` 兜底。
  - `onUnreadCount` 更新角标。

- [ ] **Step 2: 手测**：授权后收到新邮件有桌面通知 + 声音 + 标签角标；垃圾邮件不通知。

- [ ] **Step 3: Commit**

```bash
git add src/components/realtime/Notifications.tsx
git commit -m "feat(realtime): Notification API desktop notify (tiered/sound/badge/permission)"
git push
```

---

### Task 10: 集成验收 + 全量回归

**Files:**
- Modify: 测试与接线收尾

- [ ] **Step 1: 全量测试** `npm test`（含新增 eventBus/idleSupervisor/incrementalSync/health/events-SSE/useMailEvents/writeback 扩展）→ 全绿。
- [ ] **Step 2: 类型检查** `npx tsc --noEmit` → 无错。
- [ ] **Step 3: 端到端手测**：两账号 IDLE 在线 → A 收新邮件秒级到 UI + 通知；B 断网降级轮询；客户端关一个标签页、剩余标签页仍实时（BroadcastChannel 复用）；已读一封邮件 <10s 角标更新；刷新页面后状态追赶（断线期间的 new-mail 补发且不重复）。
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(realtime): full regression green for realtime+notifications"
git push
```

---

## 验收标准

- [ ] 每活跃账号维持一条 IMAP IDLE 长连接，收到 EXISTS 秒级触发增量拉取入库（<30s 端到端）。
- [ ] IDLE 每 29min 打断重 SELECT 续命，避开 30min IMAP 超时；断线指数退避重连（1s/2s/4s…封顶 60s）。
- [ ] 连续失败超阈值自动降级：`accounts.sync_status='error'` + 切换到 30s 短间隔轮询，仍能收新邮件。
- [ ] `/api/events` SSE 推 new-mail/unread-count/message-updated/status；客户端 `Last-Event-ID` 状态追赶（补发 buffered 事件）+ 业务幂等 id 去重 + 多标签页 BroadcastChannel 连接复用（单 SSE fan-out）。
- [ ] 已读/移动/标星经 UID 增量同步，状态变更 <10s 经 `message-updated` 事件到达所有客户端。
- [ ] Notification API 桌面通知按账号/文件夹分级 + 声音 + 角标 + 需用户授权。
- [ ] 60s 客户端 `setInterval` 轮询被 SSE + `useMailEvents` 替换；`refresh-bus.ts` 退化为 eventBus 薄封装不破坏旧调用方。
- [ ] `npm test` 全绿；`npx tsc --noEmit` 无错。

## 依赖

- 子项目 1（messages `account_id/folder/imap_uid` 列 + jobs 队列表 + settings KV + 迁移框架）。
- 子项目 2（`MailAdapter`/`AccountConfig`/`getAdapter(accountId)`/accounts 表 `sync_mode`[idle|poll] + `sync_status`[healthy|syncing|error|disabled] + `sync_error`）。
- 子项目 3（`folders` 表角标、`applyAction` UID 回写、`checkUidValidity` UIDVALIDITY 重映射、`classifyFolder`）。

## 风险

- **IDLE 必须在 Next.js 进程内常驻**——本地自托管 OK，**绝不可部署到 Serverless/Vercel**（进程会被冻结，长连接断）。`/api/events` 与 supervisor 都需 `runtime='nodejs'` + 持久进程。
- **29min 续命精度**：ImapFlow `idle()` 的 `onMail` 是 EXISTS 推送，但 30min 服务器侧超时是硬限制——keepalive 必须 <30min 且 logout→重连要干净，否则续命窗口失败 → 连接静默断开（需 `onClose`/`onError` 兜底走重连）。
- **SSE 多标签页**：无 BroadcastChannel leader-election 会产生 N 条 SSE 连接（每标签一条）——必须做 leader 选举，仅 leader 建 SSE、其余通过 BroadcastChannel 收事件。
- **状态追赶窗口**：`eventBus.buffer` 仅保留最近 500 条；断线超过该量会丢历史事件 → 客户端重连后除补发外，应额外拉一次 `/api/messages?since=` 全量校正（本子项目在 hook 内触发一次轻量重算）。
- **幂等**：`pullIncremental` 用 UID 高水位防重复入库，SSE 用业务幂等 id 防重复推送——两条防线缺一不可（入库去重 + 客户端去重）。
- **better-sqlite3 同步阻塞**：IDLE onMail 回调里直接跑 fetch+入库会阻塞事件循环 → `pullIncremental` 用 `setImmediate`/`queueMicrotask` 让出，重操作考虑 worker_threads（见子项目 14 NFR 性能）。
- **多账号 IDLE 并发写库 SQLITE_BUSY**：WAL 缓解非消除，`upsertMessage` 需 busy-retry（见 NFR 并发）。
- execute 前补全每个任务的 TDD 微步骤（先红后绿）。
