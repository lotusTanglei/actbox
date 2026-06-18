// src/__tests__/api/suggest-reply.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@/lib/llm/client', () => ({
  getLlmClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getModelName: () => 'reply-model',
}))

let mockDb: any
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getRawDb: () => mockDb,
}))

import { POST } from '@/app/api/suggest-reply/route'
import { memDb } from '../helpers/memDb'

describe('POST /api/suggest-reply', () => {
  beforeEach(() => {
    mockDb = memDb()
    mockDb.exec("INSERT INTO messages (id,message_id,sender,subject,body,processed_at,direction) VALUES (1,'<m>','a@b','问题','请问怎么使用？',unixepoch(),'in')")
    mockCreate.mockReset()
  })

  it('按 messageId 生成回复建议', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '[{"text":"好的","tone":"同意"},{"text":"我确认一下","tone":"询问详情"}]' } }] })
    const resp = await POST(new Request('http://x/api/suggest-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    const j = await resp.json()
    expect(j.suggestions).toHaveLength(2)
    expect(j.suggestions[0].text).toBe('好的')
  })
  it('用 reply 能力模型', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '[]' } }] })
    await POST(new Request('http://x/api/suggest-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    expect(mockCreate.mock.calls[0][0].model).toBe('reply-model')
  })
  it('消息不存在 → 404', async () => {
    const res = await POST(new Request('http://x/api/suggest-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 999 }) }))
    expect(res.status).toBe(404)
  })
  it('缺 messageId 且无 body → 400', async () => {
    const res = await POST(new Request('http://x/api/suggest-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })
})
