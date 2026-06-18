// src/__tests__/api/llm-test.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memDb } from '../helpers/memDb'

let mockDb: any
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getRawDb: () => mockDb,
}))

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat: any
    constructor() { this.chat = { completions: { create: mockCreate } } }
  },
}))

import { POST } from '@/app/api/llm/test/route'

describe('POST /api/llm/test', () => {
  beforeEach(() => {
    mockDb = memDb()
    mockCreate.mockReset()
  })

  it('连通成功 → ok:true + latencyMs + model', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'pong' } }] })
    const res = await POST(new Request('http://x/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'sk-z', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }),
    }))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.model).toBe('glm-4-flash')
    expect(typeof j.latencyMs).toBe('number')
  })

  it('401 key 错 → ok:false + error 含认证信息', async () => {
    const err = new Error('Incorrect API key provided') as any
    err.status = 401
    mockCreate.mockRejectedValue(err)
    const res = await POST(new Request('http://x/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'bad', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }),
    }))
    const j = await res.json()
    expect(j.ok).toBe(false)
    expect(j.error).toMatch(/api key|认证|401/i)
  })

  it('缺 apiKey → ok:false 明确提示', async () => {
    const resp = await POST(new Request('http://x/api/llm/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'zhipu', apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'm' }),
    }))
    const j = await resp.json()
    expect(j.ok).toBe(false)
    expect(j.error).toMatch(/api key/i)
  })
})
