// src/__tests__/adapter/imapAdapter.test.ts
// ImapAdapter 契约：fetch 用 folder+UID（非 sequence）、send 透传 html/cc/bcc/attachments、testConnection。

import { describe, it, expect, vi } from 'vitest'
import { ImapAdapter } from '@/lib/adapter/mail/imapAdapter'
import type { AccountConfig } from '@/lib/adapter/types'

function cfg(): AccountConfig {
  return { id: 1, email: 'a@b', user: 'a@b', authCode: 'x', imapHost: 'h', imapPort: 993, smtpHost: 'h', smtpPort: 465 }
}

// 空异步生成器，供 client.fetch 返回（for-await 不进循环）
async function* emptyFetch() {
  /* noop */
}

describe('ImapAdapter 契约', () => {
  it('fetch 用 folder + UID 范围（不用 sequence）', async () => {
    const search = vi.fn().mockReturnValue([10, 11, 12])
    const client = {
      connect: vi.fn(),
      logout: vi.fn(),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search,
      fetch: vi.fn(emptyFetch),
    } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.fetch({ folder: 'INBOX', uidRange: [10, 12] })
    expect(search).toHaveBeenCalledWith({ uid: { gte: 10, lte: 12 } })
  })

  it('send 透传 html/cc/bcc/attachments + In-Reply-To', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<id>' })
    const a = new ImapAdapter(cfg(), { transporterFactory: () => ({ sendMail }) as any })
    await a.send({
      to: 'b@x',
      cc: 'c@x',
      bcc: 'd@x',
      subject: 's',
      body: 't',
      bodyHtml: '<p>h</p>',
      attachments: [{ filename: 'f', path: '/p' }],
      replyToMessageId: '<orig>',
    })
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'b@x',
        cc: 'c@x',
        bcc: 'd@x',
        html: '<p>h</p>',
        attachments: expect.any(Array),
        headers: { 'In-Reply-To': '<orig>', References: '<orig>' },
      }),
    )
  })

  it('testConnection 成功返回 ok', async () => {
    const client = { connect: vi.fn().mockResolvedValue(undefined), logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    const r = await a.testConnection()
    expect(r.ok).toBe(true)
  })

  it('testConnection 失败返回 detail', async () => {
    const a = new ImapAdapter(cfg(), { clientFactory: async () => { throw new Error('auth fail') } })
    const r = await a.testConnection()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('auth fail')
  })
})
