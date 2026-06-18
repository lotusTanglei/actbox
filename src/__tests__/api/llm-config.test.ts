// src/__tests__/api/llm-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memDb } from '../helpers/memDb'

let mockDb: any
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
  getRawDb: () => mockDb,
}))

import { GET, PATCH } from '@/app/api/llm/config/route'

describe('GET /api/llm/config', () => {
  beforeEach(() => {
    mockDb = memDb()
    mockDb.exec("INSERT INTO settings (key,value) VALUES ('llm.provider','zhipu'),('llm.apiKey','sk-secret123'),('llm.model','glm-4')")
  })

  it('返回配置 + providers 列表', async () => {
    const res = await GET()
    const j = await res.json()
    expect(j.config.provider).toBe('zhipu')
    expect(j.config.model).toBe('glm-4')
    expect(j.config.apiKeySet).toBe(true)
    expect(j.providers.map((p: any) => p.name)).toContain('zhipu')
  })
  it('apiKey 脱敏(不回传明文)', async () => {
    const j = await (await GET()).json()
    expect(JSON.stringify(j)).not.toContain('sk-secret123')
    expect(j.config.apiKeyMasked).toMatch(/\*/)
  })
})

describe('PATCH /api/llm/config', () => {
  beforeEach(() => { mockDb = memDb() })

  it('保存配置', async () => {
    const res = await PATCH(new Request('http://x/api/llm/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'qwen', apiKey: 'sk-q', model: 'qwen-plus' }) }))
    expect(res.status).toBe(200)
    expect((mockDb.prepare("SELECT value FROM settings WHERE key='llm.provider'").get() as any).value).toBe('qwen')
  })
  it('空 apiKey 不清空已存', async () => {
    mockDb.exec("INSERT INTO settings (key,value) VALUES ('llm.apiKey','keep')")
    await PATCH(new Request('http://x/api/llm/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) }))
    expect((mockDb.prepare("SELECT value FROM settings WHERE key='llm.apiKey'").get() as any).value).toBe('keep')
  })
})
