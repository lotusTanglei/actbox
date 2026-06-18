// src/__tests__/llm/config.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getLlmConfig, saveLlmConfig, resolveModelForCapability, listProviders } from '@/lib/llm/config'
import { memDb } from '../helpers/memDb'

describe('getLlmConfig — DB-first + env fallback', () => {
  let db: any
  beforeEach(() => { db = memDb() })

  it('空 settings → 回落 provider defaults', () => {
    const cfg = getLlmConfig(db)
    expect(cfg.provider).toBe('deepseek')
    expect(cfg.baseUrl).toBe('https://api.deepseek.com')
    expect(cfg.model).toBe('deepseek-v4-flash')
  })
  it('DB 存 llm.* 优先于 defaults', () => {
    db.exec("INSERT INTO settings (key,value) VALUES ('llm.provider','qwen'),('llm.model','qwen-turbo'),('llm.apiKey','sk-q'),('llm.temperature','0.7')")
    const cfg = getLlmConfig(db)
    expect(cfg.provider).toBe('qwen')
    expect(cfg.model).toBe('qwen-turbo')
    expect(cfg.apiKey).toBe('sk-q')
    expect(cfg.temperature).toBe(0.7)
  })
  it('capabilities 按能力解析 model/temperature', () => {
    db.exec("INSERT INTO settings (key,value) VALUES ('llm.capability.summarize.model','glm-4-flash'),('llm.capability.classify.temperature','0.1')")
    const cfg = getLlmConfig(db)
    expect(cfg.capabilities.summarize?.model).toBe('glm-4-flash')
    expect(cfg.capabilities.classify?.temperature).toBe(0.1)
  })
})

describe('saveLlmConfig', () => {
  it('upsert 多个 key', () => {
    const db = memDb()
    saveLlmConfig(db, { provider: 'zhipu', apiKey: 'sk-z', model: 'glm-4' })
    const v = (k: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as any)?.value
    expect(v('llm.provider')).toBe('zhipu')
    expect(v('llm.apiKey')).toBe('sk-z')
  })
  it('更新已存在 key', () => {
    const db = memDb()
    saveLlmConfig(db, { apiKey: 'first' })
    saveLlmConfig(db, { apiKey: 'second' })
    expect((db.prepare("SELECT value FROM settings WHERE key='llm.apiKey'").get() as any).value).toBe('second')
  })
  it('空 apiKey 不覆盖已存非空(防误清)', () => {
    const db = memDb()
    saveLlmConfig(db, { apiKey: 'keep' })
    saveLlmConfig(db, { apiKey: '' })
    expect((db.prepare("SELECT value FROM settings WHERE key='llm.apiKey'").get() as any).value).toBe('keep')
  })
})

describe('resolveModelForCapability', () => {
  it('能力覆盖优先', () => {
    expect(resolveModelForCapability({ model: 'd', capabilities: { classify: { model: 'c-m' } } } as any, 'classify')).toBe('c-m')
  })
  it('无能力配置 → 顶层', () => {
    expect(resolveModelForCapability({ model: 'd', capabilities: {} } as any, 'summarize')).toBe('d')
  })
})

describe('listProviders', () => {
  it('返回 deepseek/qwen/zhipu 含 label 与默认', () => {
    const ps = listProviders()
    const names = ps.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(['deepseek', 'qwen', 'zhipu']))
    const z = ps.find((p) => p.name === 'zhipu')!
    expect(z.defaultBaseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
  })
})
