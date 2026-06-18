// src/__tests__/api/contacts-groups.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { GET, POST } from '@/app/api/contacts/groups/route'
import { PATCH, DELETE, GET as GM } from '@/app/api/contacts/groups/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://x${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('contacts groups API', () => {
  beforeEach(() => { refs.raw = memDb() })

  it('POST 创建分组', async () => {
    const r = await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: '团队' }))
    expect(r.status).toBe(201)
  })
  it('POST 同名返回既有 200', async () => {
    await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: 'X' }))
    const r = await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: 'X' }))
    expect(r.status).toBe(200)
  })
  it('GET 列表含成员数', async () => {
    const cr = await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: 'G' }))
    const { group } = await cr.json()
    refs.raw!.exec(`INSERT INTO contacts (account_id, name, email, group_id) VALUES (1,'A','a@x.com',${group.id})`)
    const r = await GET(req('GET', '/api/contacts/groups?accountId=1'))
    const d = await r.json()
    expect(d.groups[0].memberCount).toBe(1)
  })
  it('DELETE 组 → 成员保留 (group_id=NULL)', async () => {
    const cr = await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: 'G' }))
    const { group } = await cr.json()
    refs.raw!.exec(`INSERT INTO contacts (account_id, name, email, group_id) VALUES (1,'A','a@x.com',${group.id})`)
    const r = await DELETE(req('DELETE', `/api/contacts/groups/${group.id}`), ctx(String(group.id)))
    expect(r.status).toBe(204)
    const c = refs.raw!.prepare('SELECT group_id FROM contacts WHERE email=?').get('a@x.com') as any
    expect(c.group_id).toBeNull()
  })
  it('GET groups/[id]/members 展开成员', async () => {
    const cr = await POST(req('POST', '/api/contacts/groups', { accountId: 1, name: 'G' }))
    const { group } = await cr.json()
    refs.raw!.exec(`INSERT INTO contacts (account_id, name, email, group_id) VALUES (1,'A','a@x.com',${group.id})`)
    const r = await GM(req('GET', `/api/contacts/groups/${group.id}`), ctx(String(group.id)))
    const d = await r.json()
    expect(d.members[0].email).toBe('a@x.com')
  })
})
