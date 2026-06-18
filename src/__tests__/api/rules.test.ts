// src/__tests__/api/rules.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { GET, POST } from '@/app/api/rules/route'
import { GET as G, PATCH, DELETE } from '@/app/api/rules/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://x${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('rules API', () => {
  beforeEach(() => { refs.raw = memDb() })

  it('POST 创建规则', async () => {
    const r = await POST(req('POST', '/api/rules', { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: 'a@' }] }, actions: [{ type: 'star' }] }))
    expect(r.status).toBe(201)
    expect((await r.json()).rule.id).toBeDefined()
  })

  it('POST 缺 name → 400', async () => {
    const r = await POST(req('POST', '/api/rules', { accountId: 1 }))
    expect(r.status).toBe(400)
  })

  it('GET 按 order 排序列表', async () => {
    await POST(req('POST', '/api/rules', { accountId: 1, name: 'B', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 1 }))
    await POST(req('POST', '/api/rules', { accountId: 1, name: 'A', conditions: { combinator: 'and', conditions: [] }, actions: [], order: 0 }))
    const r = await GET(req('GET', '/api/rules?accountId=1'))
    expect((await r.json()).rules.map((x: any) => x.name)).toEqual(['A', 'B'])
  })

  it('PATCH 改 name', async () => {
    const cr = await POST(req('POST', '/api/rules', { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [] }))
    const { rule } = await cr.json()
    const r = await PATCH(req('PATCH', `/api/rules/${rule.id}`, { name: 'R2' }), ctx(String(rule.id)))
    expect((await r.json()).rule.name).toBe('R2')
  })

  it('DELETE 删除', async () => {
    const cr = await POST(req('POST', '/api/rules', { accountId: 1, name: 'R', conditions: { combinator: 'and', conditions: [] }, actions: [] }))
    const { rule } = await cr.json()
    const r = await DELETE(req('DELETE', `/api/rules/${rule.id}`), ctx(String(rule.id)))
    expect(r.status).toBe(200)
    const got = await G(req('GET', `/api/rules/${rule.id}`), ctx(String(rule.id)))
    expect((await got.json()).rule).toBeNull()
  })
})
