// src/__tests__/api/auto-tag.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@/lib/llm/client', () => ({
  getLlmClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getModelName: () => 'classify-model',
}))

let mockDb: any
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getRawDb: () => mockDb,
}))

import { POST } from '@/app/api/auto-tag/route'
import { memDb } from '../helpers/memDb'

describe('POST /api/auto-tag', () => {
  beforeEach(() => {
    mockDb = memDb()
    mockDb.exec("INSERT INTO messages (id,message_id,sender,subject,body,processed_at,direction) VALUES (1,'<m>','boss@co','紧急:合同签署','请尽快签署合同附件',unixepoch(),'in')")
    mockCreate.mockReset()
  })

  it('按 messageId 生成打标建议', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{"labels":["工作","紧急"],"priority":"high","importance":"important","reason":"合同签署有时效性"}' } }] })
    const resp = await POST(new Request('http://x/api/auto-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    const j = await resp.json()
    expect(j.labels).toContain('工作')
    expect(j.priority).toBe('high')
    expect(j.importance).toBe('important')
  })
  it('用 classify 能力模型', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{"labels":[],"priority":"normal","importance":"normal"}' } }] })
    await POST(new Request('http://x/api/auto-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    expect(mockCreate.mock.calls[0][0].model).toBe('classify-model')
  })
  it('消息不存在 → 404', async () => {
    const res = await POST(new Request('http://x/api/auto-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 999 }) }))
    expect(res.status).toBe(404)
  })
  it('缺 messageId 且无 body → 400', async () => {
    const res = await POST(new Request('http://x/api/auto-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })
})
