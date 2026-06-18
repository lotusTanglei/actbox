// src/lib/outbox/status.ts — outbox 状态机纯函数。plan-13 Task 2。
export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced'
export type OutboxEvent = 'send_started' | 'send_succeeded' | 'send_failed' | 'bounced'

export const MAX_OUTBOX_ATTEMPTS = 5
export const BASE_BACKOFF_MS = 30_000
export const MAX_BACKOFF_MS = 30 * 60_000

export interface FailContext {
  attempts: number
  maxAttempts?: number
}

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
      return attempts >= max ? 'failed' : 'queued'
    }
    case 'bounced':
      if (current !== 'sending') throw new Error(`invalid transition: ${current} + bounced`)
      return 'bounced'
    default:
      throw new Error(`unknown event: ${event as string}`)
  }
}

export function nextAttemptAt(attempts: number, nowUtcMs: number): number {
  const delay = Math.min(Math.pow(2, attempts - 1) * BASE_BACKOFF_MS, MAX_BACKOFF_MS)
  return nowUtcMs + delay
}
