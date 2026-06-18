// src/__tests__/realtime/imapIdleSupervisor.test.ts

import { describe, it, expect, vi } from 'vitest'
import { ImapIdleSupervisor } from '@/lib/realtime/imapIdleSupervisor'

/** 可控时钟:setTimeout 入队,advance(ms) 按到期顺序触发 + setImmediate 排空微任务(runLoop 续跑)。 */
function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { fireAt: number; fn: () => void }>()
  const drain = () => new Promise<void>((r) => setImmediate(r))
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { fireAt: now + (ms || 0), fn })
      return id
    },
    clearTimeout(h: unknown) {
      timers.delete(h as number)
    },
    async advance(ms: number) {
      const target = now + ms
      while (true) {
        let earliest: { id: number; fireAt: number; fn: () => void } | null = null
        for (const [id, t] of timers) {
          if (t.fireAt <= target && (!earliest || t.fireAt < earliest.fireAt)) {
            earliest = { id, fireAt: t.fireAt, fn: t.fn }
          }
        }
        if (!earliest) break
        now = Math.max(now, earliest.fireAt)
        timers.delete(earliest.id)
        await earliest.fn()
        await drain()
      }
      if (now < target) now = target
    },
    flush: drain,
  }
}

function mkIdleCtrl() {
  return { calls: 0, fire: null as null | (() => void), resolveIdle: null as null | (() => void) }
}

function mkClient(ctrl: ReturnType<typeof mkIdleCtrl>, overrides: { connect?: ReturnType<typeof vi.fn> } = {}) {
  return {
    connect: overrides.connect ?? vi.fn().mockResolvedValue(undefined),
    mailboxOpen: vi.fn().mockResolvedValue({}),
    idle: vi.fn().mockImplementation((opts: { onMail?: () => void }) => {
      ctrl.calls++
      ctrl.fire = opts.onMail ?? null
      return new Promise<void>((resolve) => {
        ctrl.resolveIdle = resolve
      })
    }),
    logout: vi.fn().mockImplementation(() => {
      ctrl.resolveIdle?.()
      ctrl.resolveIdle = null
      return Promise.resolve()
    }),
  } as any
}

describe('ImapIdleSupervisor', () => {
  it('start 后对 INBOX 调 idle 并监听 mail 事件;stop 后 logout', async () => {
    const ctrl = mkIdleCtrl()
    const client = mkClient(ctrl)
    const onNewMail = vi.fn()
    const clk = fakeClock()
    const sup = new ImapIdleSupervisor({
      accountId: 1,
      clientFactory: async () => client,
      folder: 'INBOX',
      onNewMail,
      clock: clk,
    })
    await sup.start()
    await clk.flush()
    expect(client.mailboxOpen).toHaveBeenCalledWith('INBOX')
    expect(client.idle).toHaveBeenCalled()
    ctrl.fire?.()
    expect(onNewMail).toHaveBeenCalledWith({ accountId: 1, folder: 'INBOX' })
    await sup.stop()
    expect(client.logout).toHaveBeenCalled()
  })

  it('29min 打断 idle 重 SELECT 续命(避开 30min 超时)', async () => {
    const ctrl = mkIdleCtrl()
    const client = mkClient(ctrl)
    const clk = fakeClock()
    const sup = new ImapIdleSupervisor({
      accountId: 1,
      clientFactory: async () => client,
      folder: 'INBOX',
      onNewMail: () => {},
      clock: clk,
    })
    await sup.start()
    await clk.flush()
    expect(ctrl.calls).toBe(1)
    await clk.advance(29 * 60 * 1000)
    expect(ctrl.calls).toBe(2)
    await sup.stop()
  })

  it('断线指数退避重连(1s/2s/4s…封顶)', async () => {
    const clk = fakeClock()
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValue(undefined)
    const ctrl = mkIdleCtrl()
    const client = mkClient(ctrl, { connect })
    const sup = new ImapIdleSupervisor({
      accountId: 1,
      clientFactory: async () => client,
      folder: 'INBOX',
      onNewMail: () => {},
      clock: clk,
    })
    await sup.start()
    await clk.flush()
    expect(connect).toHaveBeenCalledTimes(1)
    await clk.advance(1000)
    expect(connect).toHaveBeenCalledTimes(2)
    await clk.advance(2000)
    expect(connect).toHaveBeenCalledTimes(3)
    await sup.stop()
  })

  it('连续失败超阈值 → 降级(onDegraded + state=degraded + 停止重连)', async () => {
    const clk = fakeClock()
    const connect = vi.fn().mockRejectedValue(new Error('auth fail'))
    const ctrl = mkIdleCtrl()
    const client = mkClient(ctrl, { connect })
    const onDegraded = vi.fn()
    const sup = new ImapIdleSupervisor({
      accountId: 1,
      clientFactory: async () => client,
      folder: 'INBOX',
      onNewMail: () => {},
      onDegraded,
      clock: clk,
      maxFailures: 3,
      maxBackoffMs: 4000,
    })
    await sup.start()
    for (const d of [1000, 2000, 4000]) {
      await clk.advance(d)
    }
    expect(connect).toHaveBeenCalledTimes(3)
    expect(onDegraded).toHaveBeenCalledWith({ accountId: 1, reason: 'auth fail', attempts: 3 })
    expect(sup.state).toBe('degraded')
  })
})
