// src/__tests__/api/labels.test.ts
// TDD: 标签 CRUD API。plan-08 Task 9。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
}))

vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { GET, POST } from '@/app/api/labels/route'
import { PATCH, DELETE } from '@/app/api/labels/[id]/route'

function req(method: string, path: string, body?: object) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('labels API', () => {
  beforeEach(() => {
    refs.raw = memDb()
  })

  it('POST /api/labels 创建标签', async () => {
    const res = await POST(req('POST', '/api/labels', { accountId: 1, name: '重要', color: '#ef4444' }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.label.name).toBe('重要')
    expect(data.label.color).toBe('#ef4444')
  })

  it('POST 同名重复返回既有 200', async () => {
    await POST(req('POST', '/api/labels', { accountId: 1, name: '重要', color: '#ef4444' }))
    const res = await POST(req('POST', '/api/labels', { accountId: 1, name: '重要', color: '#000' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.label.color).toBe('#ef4444') // 不覆盖
  })

  it('GET /api/labels?accountId=1 列表', async () => {
    await POST(req('POST', '/api/labels', { accountId: 1, name: 'A' }))
    await POST(req('POST', '/api/labels', { accountId: 1, name: 'B' }))
    const res = await GET(req('GET', '/api/labels?accountId=1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.labels).toHaveLength(2)
  })

  it('PATCH /api/labels/[id] 改名/改色', async () => {
    const created = await POST(req('POST', '/api/labels', { accountId: 1, name: '旧名' }))
    const { label } = await created.json()
    const res = await PATCH(req('PATCH', `/api/labels/${label.id}`, { name: '新名', color: '#00ff00' }), ctx(String(label.id)))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.label.name).toBe('新名')
    expect(data.label.color).toBe('#00ff00')
  })

  it('DELETE /api/labels/[id] 删除 + 级联 message_labels', async () => {
    const created = await POST(req('POST', '/api/labels', { accountId: 1, name: '待删' }))
    const { label } = await created.json()

    // 创建关联
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, received_at, processed_at, todo_count) VALUES (1,'<m>',1,'s','a@x','in','INBOX',1,1,0)`)
    refs.raw!.exec(`INSERT INTO message_labels (message_id, label_id) VALUES (1, ${label.id})`)

    const res = await DELETE(req('DELETE', `/api/labels/${label.id}`), ctx(String(label.id)))
    expect(res.status).toBe(200)

    // 标签已删除
    const list = await (await GET(req('GET', '/api/labels?accountId=1'))).json()
    expect(list.labels).toHaveLength(0)

    // 关联也已删除
    const c = refs.raw!.prepare('SELECT count(*) c FROM message_labels').get() as { c: number }
    expect(c.c).toBe(0)
  })
})
