// src/components/realtime/useMailEvents.ts
// 客户端实时事件:SSE 自动重连(EventSource 原生 Last-Event-ID)+ 业务幂等去重 +
// BroadcastChannel 多标签页复用(leader 选举,单 SSE fan-out)。plan-06 Task 6。

'use client'

import { useEffect, useRef } from 'react'
import type { EventEnvelope, MailEvent } from '@/lib/events/types'

type PayloadOf<T extends MailEvent['type']> = Extract<MailEvent, { type: T }>['payload']

export interface MailEventCallbacks {
  onNewMail?: (p: PayloadOf<'new-mail'>) => void
  onUnreadCount?: (p: PayloadOf<'unread-count'>) => void
  onMessageUpdated?: (p: PayloadOf<'message-updated'>) => void
  onStatus?: (p: PayloadOf<'status'>) => void
}

/**
 * 派发核心(纯逻辑,可单测):按 seq 单调 + 业务 id 幂等去重,分发到回调。
 */
export class MailEventDispatcher {
  private lastSeq = 0
  private seen = new Set<string>()
  private seenOrder: string[] = []
  private cb: MailEventCallbacks
  constructor(cb: MailEventCallbacks) {
    this.cb = cb
  }
  updateCallbacks(cb: MailEventCallbacks) {
    this.cb = cb
  }
  get lastEventId(): number {
    return this.lastSeq
  }
  dispatch(e: EventEnvelope): boolean {
    if (e.seq <= this.lastSeq) return false
    if (this.seen.has(e.id)) return false
    this.seen.add(e.id)
    this.seenOrder.push(e.id)
    if (this.seen.size > 200) {
      const old = this.seenOrder.shift()!
      this.seen.delete(old)
    }
    this.lastSeq = e.seq
    switch (e.type) {
      case 'new-mail':
        this.cb.onNewMail?.(e.payload as PayloadOf<'new-mail'>)
        break
      case 'unread-count':
        this.cb.onUnreadCount?.(e.payload as PayloadOf<'unread-count'>)
        break
      case 'message-updated':
        this.cb.onMessageUpdated?.(e.payload as PayloadOf<'message-updated'>)
        break
      case 'status':
        this.cb.onStatus?.(e.payload as PayloadOf<'status'>)
        break
    }
    return true
  }
}

function deriveId(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'new-mail':
      return `new-mail:${payload.messageId}`
    case 'unread-count':
      return `unread:${payload.accountId}:${payload.folder}:${payload.unread}`
    case 'message-updated':
      return `upd:${payload.messageId}:${JSON.stringify(payload.changes)}`
    default:
      return `${type}:${payload.accountId ?? ''}:${Date.now()}`
  }
}

export function useMailEvents(cb: MailEventCallbacks): { lastEventId: number } {
  const dispRef = useRef<MailEventDispatcher | null>(null)
  if (dispRef.current == null) dispRef.current = new MailEventDispatcher(cb)
  const cbRef = useRef(cb)
  cbRef.current = cb

  useEffect(() => {
    const disp = dispRef.current!
    const CHANNEL = 'actbox-events'
    const LOCK_KEY = 'actbox-sse-leader'
    const LOCK_TTL = 8000
    const tabId = Math.random().toString(36).slice(2)
    let es: EventSource | null = null
    let renewTimer: ReturnType<typeof setInterval> | null = null
    let leader = false

    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null

    const lockHeldByOther = () => {
      try {
        const raw = localStorage.getItem(LOCK_KEY)
        if (!raw) return false
        const owner = JSON.parse(raw) as { tab: string; ts: number }
        return owner.tab !== tabId && Date.now() - owner.ts < LOCK_TTL
      } catch {
        return false
      }
    }
    const writeLock = () => {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: tabId, ts: Date.now() }))
      } catch {
        /* ignore */
      }
    }
    const openSSE = () => {
      es = new EventSource('/api/events')
      ;(['new-mail', 'unread-count', 'message-updated', 'status'] as const).forEach((type) => {
        es!.addEventListener(type, (ev) => {
          const evm = ev as MessageEvent
          try {
            const payload = JSON.parse(evm.data)
            const seq = Number(evm.lastEventId)
            const e = { seq, type, payload, id: deriveId(type, payload), ts: Date.now() } as EventEnvelope
            if (disp.dispatch(e)) bc?.postMessage(e)
          } catch {
            /* ignore */
          }
        })
      })
    }
    const acquire = () => {
      if (leader) {
        writeLock()
        return
      }
      if (lockHeldByOther()) return
      writeLock()
      if (lockHeldByOther()) return
      leader = true
      openSSE()
    }

    bc?.addEventListener('message', (ev) => {
      disp.dispatch((ev as MessageEvent).data as EventEnvelope)
    })
    acquire()
    renewTimer = setInterval(acquire, 3000)
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCK_KEY) acquire()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      es?.close()
      if (renewTimer) clearInterval(renewTimer)
      window.removeEventListener('storage', onStorage)
      bc?.close()
      if (leader) {
        try {
          localStorage.removeItem(LOCK_KEY)
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  useEffect(() => {
    dispRef.current?.updateCallbacks(cbRef.current)
  })

  return { lastEventId: dispRef.current.lastEventId }
}
