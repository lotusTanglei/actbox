// src/lib/events/eventBus.ts
// 进程内发布订阅:SSE 事件源。单调递增 seq + 环形 buffer(状态追赶)。plan-06 Task 1。

import type { EventEnvelope, MailEvent } from './types'

type Subscriber = (e: EventEnvelope) => void

const BUFFER_MAX = 500

class EventBus {
  private subscribers = new Set<Subscriber>()
  private seq = 0
  private buffer: EventEnvelope[] = []

  publish(ev: MailEvent): EventEnvelope {
    const envelope: EventEnvelope = {
      seq: ++this.seq,
      type: ev.type,
      payload: ev.payload,
      id: idFor(ev),
      ts: Date.now(),
    }
    this.buffer.push(envelope)
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX)
    for (const s of this.subscribers) {
      try {
        s(envelope)
      } catch {
        /* 单个订阅者失败不影响其他 */
      }
    }
    return envelope
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  lastSeq(): number {
    return this.seq
  }

  since(seq: number): EventEnvelope[] {
    return this.buffer.filter((e) => e.seq > seq)
  }

  /** 测试用:重置 seq/buffer/订阅者。 */
  _reset(): void {
    this.subscribers.clear()
    this.seq = 0
    this.buffer = []
  }
}

function idFor(ev: MailEvent): string {
  switch (ev.type) {
    case 'new-mail':
      return `new-mail:${ev.payload.messageId}`
    case 'unread-count':
      return `unread:${ev.payload.accountId}:${ev.payload.folder}:${ev.payload.unread}`
    case 'message-updated':
      return `upd:${ev.payload.messageId}:${JSON.stringify(ev.payload.changes)}`
    case 'status':
      return `status:${ev.payload.accountId}:${ev.payload.status}:${Date.now()}`
  }
}

export const eventBus = new EventBus()

/** 测试辅助:重置单例。 */
export function resetEventBus(): void {
  eventBus._reset()
}
