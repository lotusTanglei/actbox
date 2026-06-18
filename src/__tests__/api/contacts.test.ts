// src/__tests__/api/contacts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { GET, POST } from '@/app/api/contacts/route'
import { GET as G, PATCH, DELETE } from '@/app/api/contacts/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://x${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('contacts API', () => {
  beforeEach(() => { refs.raw = memDb() })

  it('POST /api/contacts 创建', async () => {
    const res = await POST(req('POST', '/api/contacts', { accountId: 1, name: '张三', email: 'z@x.com' }))
    expect(res.status).toBe(201)
    const d = await res.json()
    expect(d.contact.name).toBe('张三')
  })

  it('POST 同 email 返回既有 200', async () => {
    await POST(req('POST', '/api/contacts', { accountId: 1, name: '张三', email: 'z@x.com' }))
    const res = await POST(req('POST', '/api/contacts', { accountId: 1, name: '张三丰', email: 'z@x.com' }))
    expect(res.status).toBe(200)
  })

  it('GET /api/contacts?q= 搜索', async () => {
    await POST(req('POST', '/api/contacts', { accountId: 1, name: '张', email: 'z@x.com' }))
    await POST(req('POST', '/api/contacts', { accountId: 1, name: '李', email: 'l@y.com' }))
    const res = await GET(req('GET', '/api/contacts?accountId=1&q=张'))
    const d = await res.json()
    expect(d.contacts).toHaveLength(1)
  })

  it('GET /api/contacts/[id]', async () => {
    const r = await POST(req('POST', '/api/contacts', { accountId: 1, name: 'A', email: 'a@x.com' }))
    const { contact } = await r.json()
    const res = await G(req('GET', `/api/contacts/${contact.id}`), ctx(String(contact.id)))
    expect(res.status).toBe(200)
    expect((await res.json()).contact.name).toBe('A')
  })

  it('PATCH /api/contacts/[id]', async () => {
    const r = await POST(req('POST', '/api/contacts', { accountId: 1, name: '老名', email: 'e@x.com' }))
    const { contact } = await r.json()
    const res = await PATCH(req('PATCH', `/api/contacts/${contact.id}`, { name: '新名' }), ctx(String(contact.id)))
    expect(res.status).toBe(200)
    expect((await res.json()).contact.name).toBe('新名')
  })

  it('DELETE /api/contacts/[id]', async () => {
    const r = await POST(req('POST', '/api/contacts', { accountId: 1, name: 'D', email: 'd@x.com' }))
    const { contact } = await r.json()
    const res = await DELETE(req('DELETE', `/api/contacts/${contact.id}`), ctx(String(contact.id)))
    expect(res.status).toBe(204)
  })
})
