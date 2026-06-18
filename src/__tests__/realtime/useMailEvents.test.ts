// src/__tests__/realtime/useMailEvents.test.ts
// 测试可注入的派发核心 MailEventDispatcher(去重 + lastEventId);hook 仅为 EventSource/BC 薄封装。

import { describe, it, expect, vi } from 'vitest'
import { MailEventDispatcher } from '@/components/realtime/useMailEvents'
import type { EventEnvelope } from '@/lib/events/types'

function env(seq: number, type: any, payload: any, id: string): EventEnvelope {
  return { seq, type, payload, id, ts: 0 }
}

describe('MailEventDispatcher', () => {
  it('收到 new-mail 回调,同业务 id 幂等去重', () => {
    const onNewMail = vi.fn()
    const d = new MailEventDispatcher({ onNewMail })
    d.dispatch(env(1, 'new-mail', { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: 's', from: 'a' }, 'new-mail:m1'))
    d.dispatch(env(2, 'new-mail', { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: 's', from: 'a' }, 'new-mail:m1'))
    expect(onNewMail).toHaveBeenCalledTimes(1)
  })

  it('lastEventId 跟随最大 seq', () => {
    const d = new MailEventDispatcher({})
    d.dispatch(env(42, 'status', { accountId: 1, status: 'healthy' }, 'x'))
    expect(d.lastEventId).toBe(42)
  })

  it('旧 seq(<= lastEventId)丢弃', () => {
    const fn = vi.fn()
    const d = new MailEventDispatcher({ onStatus: fn })
    d.dispatch(env(10, 'status', { accountId: 1, status: 'healthy' }, 'a'))
    expect(d.dispatch(env(5, 'status', { accountId: 1, status: 'error' }, 'b'))).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('unread-count / message-updated / status 各自分发', () => {
    const cb = { onUnreadCount: vi.fn(), onMessageUpdated: vi.fn(), onStatus: vi.fn() }
    const d = new MailEventDispatcher(cb)
    d.dispatch(env(1, 'unread-count', { accountId: 1, folder: 'INBOX', unread: 3, total: 5 }, 'u1'))
    d.dispatch(env(2, 'message-updated', { messageId: 'm', accountId: 1, folder: 'INBOX', changes: { isRead: true } }, 'm1'))
    d.dispatch(env(3, 'status', { accountId: 1, status: 'syncing' }, 's1'))
    expect(cb.onUnreadCount).toHaveBeenCalledOnce()
    expect(cb.onMessageUpdated).toHaveBeenCalledOnce()
    expect(cb.onStatus).toHaveBeenCalledOnce()
  })
})
