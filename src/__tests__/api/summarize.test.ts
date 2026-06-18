// src/__tests__/api/summarize.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@/lib/llm/client', () => ({
  getLlmClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getModelName: () => 'sum-model',
}))

let mockDb: any
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getRawDb: () => mockDb,
}))

import { POST } from '@/app/api/summarize/route'
import { memDb } from '../helpers/memDb'

describe('POST /api/summarize', () => {
  beforeEach(() => {
    mockDb = memDb()
    mockDb.exec("INSERT INTO messages (id,message_id,sender,subject,body,processed_at,direction) VALUES (1,'<m>','a@b','关于项目进度','很长的正文',unixepoch(),'in')")
    mockCreate.mockReset()
  })

  it('按 messageId 取正文生成摘要', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '项目进度正常,本周交付模块 A。' } }] })
    const resp = await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    const j = await resp.json()
    expect(j.summary).toContain('项目进度')
    expect(mockCreate).toHaveBeenCalled()
  })
  it('用 summarize 能力的模型', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 's' } }] })
    await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    expect(mockCreate.mock.calls[0][0].model).toBe('sum-model')
  })
  it('消息不存在 → 404', async () => {
    const res = await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 999 }) }))
    expect(res.status).toBe(404)
  })
  it('缺 messageId 且无 body → 400', async () => {
    const res = await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })
})
