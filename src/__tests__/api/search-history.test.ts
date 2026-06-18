// src/__tests__/api/search-history.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getRawDb: () => refs.raw }))

import { GET, POST, DELETE } from '@/app/api/search/history/route'

function req(method: string, body?: object) {
  return new NextRequest('http://x/api/search/history', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('搜索历史', () => {
  beforeEach(() => {
    refs.raw = memDb()
  })

  it('POST {query} 记录;GET 返回历史', async () => {
    await POST(req('POST', { query: '报告' }))
    const list = await (await GET(req('GET'))).json()
    expect(list.history.some((h: { query: string }) => h.query === '报告')).toBe(true)
  })

  it('相同 query 去重仅留最新', async () => {
    await POST(req('POST', { query: '报告' }))
    await POST(req('POST', { query: '报告' }))
    const list = await (await GET(req('GET'))).json()
    expect(list.history.filter((h: { query: string }) => h.query === '报告').length).toBe(1)
  })

  it('DELETE 清空', async () => {
    await POST(req('POST', { query: '报告' }))
    await DELETE(req('DELETE'))
    const list = await (await GET(req('GET'))).json()
    expect(list.history.length).toBe(0)
  })

  it('空 query → 400', async () => {
    const r = await POST(req('POST', { query: '  ' }))
    expect(r.status).toBe(400)
  })
})
