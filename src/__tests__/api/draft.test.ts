// src/__tests__/api/draft.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
  ddb: null as ReturnType<typeof drizzle> | null,
}))
vi.mock('@/lib/db', () => ({ getDb: () => refs.ddb, getRawDb: () => refs.raw }))

import { POST as draftPost } from '@/app/api/draft/route'
import { GET as draftGet, PATCH as draftPatch, DELETE as draftDelete } from '@/app/api/draft/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function createDraft(o: object) {
  const res = await draftPost(req('POST', '/api/draft', { accountId: 1, ...o }))
  return (await res.json()).id as number
}

describe('draft CRUD', () => {
  beforeEach(() => {
    refs.raw = memDb()
    refs.ddb = drizzle(refs.raw, { schema })
  })

  it('POST 创建草稿返回 id(direction=draft)', async () => {
    const res = await draftPost(req('POST', '/api/draft', { accountId: 1, subject: 's', body: 'b' }))
    const data = await res.json()
    expect(data.id).toBeGreaterThan(0)
    const row = refs.raw!.prepare('SELECT direction FROM messages WHERE id = ?').get(data.id) as {
      direction: string
    }
    expect(row.direction).toBe('draft')
  })

  it('PATCH 续编不丢字段(to/cc/bcc/subject/body/bodyHtml 全量覆盖)', async () => {
    const id = await createDraft({ subject: 's', body: 'b' })
    const res = await draftPatch(
      req('PATCH', `/api/draft/${id}`, { to: 'b@y', cc: 'c@z', subject: 's2', body: 'b2', bodyHtml: '<p>2</p>' }),
      ctx(String(id)),
    )
    expect(res.status).toBe(200)
    const row = refs.raw!.prepare(
      'SELECT "to" AS t, cc, subject, body, body_html FROM messages WHERE id = ?',
    ).get(id) as { t: string; cc: string; subject: string; body: string; body_html: string }
    expect(row).toMatchObject({ t: 'b@y', cc: 'c@z', subject: 's2', body: 'b2', body_html: '<p>2</p>' })
  })

  it('PATCH 非 draft 行 → 404', async () => {
    // 直接插一行 direction='in'
    refs.raw!.prepare(
      `INSERT INTO messages (message_id, direction, processed_at) VALUES ('<in>','in',?)`,
    ).run(Math.floor(Date.now() / 1000))
    const id = (refs.raw!.prepare('SELECT id FROM messages').get() as { id: number }).id
    const res = await draftPatch(req('PATCH', `/api/draft/${id}`, { subject: 'x' }), ctx(String(id)))
    expect(res.status).toBe(404)
  })

  it('GET /api/draft/[id] 返回草稿全字段', async () => {
    const id = await createDraft({ subject: 's' })
    const res = await draftGet(req('GET', `/api/draft/${id}`), ctx(String(id)))
    const data = await res.json()
    expect(data.draft.id).toBe(id)
  })

  it('DELETE /api/draft/[id] 删除草稿', async () => {
    const id = await createDraft({ subject: 's' })
    await draftDelete(req('DELETE', `/api/draft/${id}`), ctx(String(id)))
    const row = refs.raw!.prepare('SELECT id FROM messages WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })
})
