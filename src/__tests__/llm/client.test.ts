// src/__tests__/llm/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OpenAI from 'openai'

let mockCfg: any = { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com', temperature: 0.3, capabilities: {} }

vi.mock('@/lib/llm/config', () => ({
  getLlmConfig: () => mockCfg,
  resolveProviderName: (name?: string) => {
    if (name === 'deepseek' || name === 'qwen' || name === 'zhipu' || !name) return name || 'deepseek'
    throw new Error(`Unknown provider: ${name}`)
  },
}))

import { getLlmClient, getModelName, __resetLlmClientCache } from '@/lib/llm/client'

function __setCfg(c: any) { mockCfg = { ...mockCfg, ...c } }

describe('getLlmClient — DB-first + 单例缓存', () => {
  beforeEach(() => {
    __resetLlmClientCache()
    __setCfg({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com', temperature: 0.3, capabilities: {} })
  })

  it('返回 OpenAI 兼容客户端实例', () => {
    const c = getLlmClient()
    expect(c).toBeInstanceOf(OpenAI)
  })
  it('相同 provider+baseUrl 复用同一实例', () => {
    expect(getLlmClient()).toBe(getLlmClient())
  })
  it('改 baseUrl 重建客户端(不复用旧实例)', () => {
    const a = getLlmClient()
    __setCfg({ baseUrl: 'https://other.example.com/v1' })
    const b = getLlmClient()
    expect(b).not.toBe(a)
  })
  it('缺 apiKey 抛可读错误', () => {
    __setCfg({ apiKey: '' })
    expect(() => getLlmClient()).toThrow(/API key/i)
  })
})

describe('getModelName — 按能力取模型', () => {
  it('无 capability 用顶层 model', () => {
    __setCfg({ model: 'deepseek-v4-flash', capabilities: {} })
    expect(getModelName()).toBe('deepseek-v4-flash')
  })
  it('capability 有覆盖模型 → 用覆盖', () => {
    __setCfg({ model: 'default-m', capabilities: { summarize: { model: 'sum-m' } } })
    expect(getModelName('summarize')).toBe('sum-m')
  })
  it('capability 未配置 → 回落顶层 model', () => {
    __setCfg({ model: 'default-m', capabilities: {} })
    expect(getModelName('polish')).toBe('default-m')
  })
})
