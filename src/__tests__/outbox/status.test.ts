import { describe, it, expect } from 'vitest'
import { transitionOutboxStatus, nextAttemptAt, MAX_OUTBOX_ATTEMPTS, MAX_BACKOFF_MS } from '@/lib/outbox/status'

describe('transitionOutboxStatus — 状态机流转', () => {
  it('queued + send_started → sending', () => {
    expect(transitionOutboxStatus('queued', 'send_started')).toBe('sending')
  })
  it('sending + send_succeeded → sent', () => {
    expect(transitionOutboxStatus('sending', 'send_succeeded')).toBe('sent')
  })
  it('sending + send_failed → 未满仍 queued / 满 failed', () => {
    expect(transitionOutboxStatus('sending', 'send_failed', { attempts: 1, maxAttempts: 5 })).toBe('queued')
    expect(transitionOutboxStatus('sending', 'send_failed', { attempts: 5, maxAttempts: 5 })).toBe('failed')
  })
  it('sending + bounced → bounced', () => {
    expect(transitionOutboxStatus('sending', 'bounced')).toBe('bounced')
  })
  it('非法流转抛错', () => {
    expect(() => transitionOutboxStatus('sending', 'send_started')).toThrow(/invalid/i)
    expect(() => transitionOutboxStatus('sent', 'send_started')).toThrow(/invalid/i)
    expect(() => transitionOutboxStatus('failed', 'send_succeeded')).toThrow(/invalid/i)
  })
})

describe('nextAttemptAt — 指数退避', () => {
  const now = 1_700_000_000_000
  it('第1次失败 → +30s', () => { expect(nextAttemptAt(1, now) - now).toBe(30_000) })
  it('指数增长', () => { expect(nextAttemptAt(2, now) - now).toBe(60_000); expect(nextAttemptAt(3, now) - now).toBe(120_000) })
  it('封顶 30min', () => { expect(nextAttemptAt(10, now) - now).toBe(MAX_BACKOFF_MS) })
  it('MAX_OUTBOX_ATTEMPTS=5', () => { expect(MAX_OUTBOX_ATTEMPTS).toBe(5) })
})
