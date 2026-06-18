// src/__tests__/events/eventBus.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventBus, resetEventBus } from '@/lib/events/eventBus'
import type { EventEnvelope } from '@/lib/events/types'

describe('eventBus 进程内发布订阅', () => {
  beforeEach(() => {
    resetEventBus() // 单例 seq/buffer 在测试间重置
  })

  it('subscribe 收到 publish 的事件 + 单调递增 seq', () => {
    const seen: EventEnvelope[] = []
    eventBus.subscribe((e) => seen.push(e))
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: null, from: null } })
    eventBus.publish({ type: 'unread-count', payload: { accountId: 1, folder: 'INBOX', unread: 3, total: 5 } })
    expect(seen.map((e) => e.seq)).toEqual([1, 2])
    expect(seen[0]).toMatchObject({ type: 'new-mail', payload: { messageId: 'm1' } })
  })

  it('subscribe 返回 unsubscribe,取消后不再收', () => {
    const fn = vi.fn()
    const off = eventBus.subscribe(fn)
    eventBus.publish({ type: 'status', payload: { accountId: 1, status: 'syncing' } })
    off()
    eventBus.publish({ type: 'status', payload: { accountId: 1, status: 'healthy' } })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('since(seq) 返回已 buffer 的事件(状态追赶)', () => {
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'a', accountId: 1, folder: 'INBOX', subject: null, from: null } })
    eventBus.publish({ type: 'new-mail', payload: { messageId: 'b', accountId: 1, folder: 'INBOX', subject: null, from: null } })
    const last = eventBus.lastSeq()
    const missed = eventBus.since(last - 1)
    expect(missed.map((e) => (e.payload as { messageId: string }).messageId)).toEqual(['b'])
  })

  it('buffer 封顶保留最近 N 条', () => {
    for (let i = 0; i < 510; i++) {
      eventBus.publish({ type: 'status', payload: { accountId: i, status: 'healthy' } })
    }
    expect(eventBus.since(0).length).toBeLessThanOrEqual(500)
  })
})
