// src/__tests__/api/search-saved.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getRawDb: () => refs.raw }))

import { GET, POST } from '@/app/api/search/saved/route'
import { DELETE } from '@/app/api/search/saved/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://x${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('Saved Search', () => {
  beforeEach(() => {
    refs.raw = memDb()
  })

  it('POST {name,query} → 200 持久化;GET 返回列表', async () => {
    const r = await POST(req('POST', '/api/search/saved', { name: '老板邮件', query: 'from:boss' }))
    expect(r.status).toBe(200)
    const list = await (await GET(req('GET', '/api/search/saved'))).json()
    expect(list.searches.some((s: { name: string; query: string }) => s.name === '老板邮件' && s.query === 'from:boss')).toBe(true)
  })

  it('缺少 name/query → 400', async () => {
    const r = await POST(req('POST', '/api/search/saved', { name: 'n' }))
    expect(r.status).toBe(400)
  })

  it('DELETE /[id] 移除指定 Saved Search', async () => {
    await POST(req('POST', '/api/search/saved', { name: 'n', query: 'q' }))
    const before = await (await GET(req('GET', '/api/search/saved'))).json()
    const id = before.searches[0].id
    const r = await DELETE(req('DELETE', `/api/search/saved/${id}`), ctx(id))
    expect(r.status).toBe(200)
    const after = await (await GET(req('GET', '/api/search/saved'))).json()
    expect(after.searches.find((s: { id: string }) => s.id === id)).toBeUndefined()
  })
})
