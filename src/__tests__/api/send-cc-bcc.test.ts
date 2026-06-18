// src/__tests__/api/send-cc-bcc.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
  ddb: null as ReturnType<typeof drizzle> | null,
  send: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ getDb: () => refs.ddb, getRawDb: () => refs.raw }))
vi.mock('@/lib/adapter/mail/adapterRegistry', () => ({
  getAdapter: () => ({ send: (...a: unknown[]) => refs.send(...a) }),
  listActiveAccountIds: () => [1],
  ensureBootstrapAccount: () => 1,
}))

import { POST } from '@/app/api/send/route'

const NOW = Math.floor(Date.now() / 1000)

function post(body: object) {
  return new NextRequest('http://localhost/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/send cc/bcc/forward', () => {
  beforeEach(() => {
    refs.raw = memDb()
    refs.ddb = drizzle(refs.raw, { schema })
    refs.send = vi.fn().mockResolvedValue({ messageId: '<out>' })
    refs.raw
      .prepare(
        `INSERT INTO accounts (email, provider, user, auth_code, imap_host, imap_port, smtp_host, smtp_port, created_at)
         VALUES ('a@x','163','a@x','c','h',993,'h',465,?)`,
      )
      .run(NOW)
  })

  it('透传 cc/bcc 到 adapter.send 并入库 to/cc/bcc', async () => {
    await POST(
      post({ accountId: 1, to: 'b@y', cc: 'c@z', bcc: 'd@w', subject: 's', body: 't', bodyHtml: '<p>t</p>' }),
    )
    expect(refs.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@y', cc: 'c@z', bcc: 'd@w' }))
    const row = refs.raw!.prepare('SELECT "to" AS t, cc, bcc, direction FROM messages').get() as {
      t: string
      cc: string
      bcc: string
      direction: string
    }
    expect(row).toMatchObject({ t: 'b@y', cc: 'c@z', bcc: 'd@w', direction: 'out' })
  })

  it('非法收件人 → 400 + invalid', async () => {
    const res = await POST(post({ accountId: 1, to: 'not-email', subject: 's', body: 't' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.invalid).toEqual(['not-email'])
  })

  it('forwardOfMessageId → buildForward 头(Auto-Submitted)', async () => {
    refs.raw!
      .prepare(
        `INSERT INTO messages (message_id, subject, sender, "to", body, direction, processed_at)
         VALUES ('<orig>','Hi','a@x','b@y','Hello','in',?)`,
      )
      .run(NOW)
    await POST(post({ accountId: 1, to: 'x@z', subject: 's', body: 't', forwardOfMessageId: '<orig>' }))
    expect(refs.send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Auto-Submitted': 'auto-replied', References: '<orig>' }),
      }),
    )
  })
})
