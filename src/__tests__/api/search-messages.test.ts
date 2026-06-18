// src/__tests__/api/search-messages.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => {
  // minimal rawDb stub: prepare → get → all 返回空
  return {
    getDb: () => ({}),
    getRawDb: () => ({
      prepare: () => ({
        all: () => [],
        get: () => ({ c: 0 }),
      }),
    }),
  }
})
vi.mock('@/lib/search/fts', () => ({
  searchMessages: vi.fn().mockReturnValue([
    { id: 1, messageId: '<m1>', subject: '报告', sender: 'a@x', receivedAt: 1, isRead: 0, isStarred: 0, accountId: 1, folder: 'INBOX' },
  ]),
}))

import { GET } from '@/app/api/messages/route'
import { searchMessages } from '@/lib/search/fts'

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('GET /api/messages?q= 走 FTS5', () => {
  beforeEach(() => vi.clearAllMocks())

  it('q 非空 → 调 searchMessages,sort 默认 relevance,跨文件夹', async () => {
    const res = await GET(req('http://x/api/messages?q=报告&sort=relevance'))
    expect(res.status).toBe(200)
    expect(searchMessages).toHaveBeenCalled()
    const arg = (searchMessages as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(arg.sort).toBe('relevance')
    expect(arg.folder).toBeUndefined()
    const body = await res.json()
    expect(body.messages.length).toBeGreaterThan(0)
  })

  it('sort=time 透传', async () => {
    await GET(req('http://x/api/messages?q=hi&sort=time'))
    expect((searchMessages as ReturnType<typeof vi.fn>).mock.calls[0][2].sort).toBe('time')
  })

  it('accountId/folder 透传二次过滤', async () => {
    await GET(req('http://x/api/messages?q=hi&accountId=2&folder=Sent'))
    const arg = (searchMessages as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(arg.accountId).toBe(2)
    expect(arg.folder).toBe('Sent')
  })

  it('无 q → 保留原结构化过滤路径', async () => {
    const res = await GET(req('http://x/api/messages?direction=in'))
    expect(res.status).toBe(200)
  })
})
