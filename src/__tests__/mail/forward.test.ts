// src/__tests__/mail/forward.test.ts

import { describe, it, expect } from 'vitest'
import { buildForward } from '@/lib/mail/forward'

describe('buildForward', () => {
  it('引用原文块 + Forward 头', () => {
    const src = {
      messageId: '<orig>',
      subject: 'Hi',
      from: 'a@x.com',
      to: 'b@y.com',
      body: 'Hello',
      receivedAt: new Date('2026-06-17T00:00:00Z'),
    }
    const out = buildForward(src, { accountId: 1 })
    expect(out.subject).toBe('Fwd: Hi')
    expect(out.body).toContain('Hello')
    expect(out.body).toContain('-----原始邮件-----')
    expect(out.headers['Auto-Submitted']).toBe('auto-replied')
    expect(out.headers['References']).toContain('<orig>')
    expect(out.headers['In-Reply-To']).toBe('<orig>')
  })

  it('subject 已含 Fwd: 不再叠加', () => {
    const out = buildForward(
      { messageId: '<o>', subject: 'Fwd: Hi', from: 'a', to: 'b', body: 'x', receivedAt: null },
      { accountId: 1 },
    )
    expect(out.subject).toBe('Fwd: Hi')
  })

  it('无 messageId 时头不崩(仍有 Auto-Submitted)', () => {
    const out = buildForward(
      { messageId: '', subject: 's', from: 'a', to: 'b', body: 'x', receivedAt: null },
      { accountId: 1 },
    )
    expect(out.headers).toBeDefined()
    expect(out.headers['Auto-Submitted']).toBe('auto-replied')
    expect(out.headers['References']).toBeUndefined()
  })
})
