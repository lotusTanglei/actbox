// src/lib/llm/config.ts — LLM 配置中心(settings 表读写 + 按能力解析)。plan-12 Task 2。
import { PROVIDERS, resolveProviderName, type ProviderName, DEFAULT_TEMPERATURE } from './providers'
import type { LlmCapability } from './client'

export interface LlmCapabilityOverride {
  model?: string
  temperature?: number
}

export interface LlmConfig {
  provider: ProviderName
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  capabilities: Partial<Record<LlmCapability, LlmCapabilityOverride>>
}

const CAPABILITIES: LlmCapability[] = ['summarize', 'polish', 'classify', 'extract', 'reply']

function dbOf(db?: any): any {
  if (db) return db
  // 惰性取全局 getDb,避免循环依赖 + 测试注入
  const { getDb } = require('@/lib/db')
  return getDb()
}

function readAll(db: any): Record<string, string> {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  } catch {
    // settings 表可能不存在(测试环境)
    return {}
  }
}

/**
 * 读 LLM 配置:DB(settings 表)优先,缺失项回落 provider defaults 与 env。
 * 注入 db 供单测。
 */
export function getLlmConfig(db?: any): LlmConfig {
  const s = readAll(dbOf(db))
  const provider = (s['llm.provider'] as ProviderName) || 'deepseek'
  const pcfg = PROVIDERS[resolveProviderName(provider)]
  const apiKey = s['llm.apiKey'] || process.env[pcfg.apiKeyEnvVar] || ''
  const baseUrl = s['llm.baseUrl'] || process.env[pcfg.baseUrlEnvVar] || pcfg.defaults.baseUrl
  const model = s['llm.model'] || process.env[pcfg.modelEnvVar] || pcfg.defaults.model
  const temperature = s['llm.temperature'] !== undefined ? Number(s['llm.temperature']) : DEFAULT_TEMPERATURE
  const capabilities: Partial<Record<LlmCapability, LlmCapabilityOverride>> = {}
  for (const cap of CAPABILITIES) {
    const m = s[`llm.capability.${cap}.model`]
    const t = s[`llm.capability.${cap}.temperature`]
    if (m !== undefined || t !== undefined) {
      capabilities[cap] = { model: m, temperature: t !== undefined ? Number(t) : undefined }
    }
  }
  return { provider, apiKey, baseUrl, model, temperature, capabilities }
}

/**
 * 写一组 LLM 配置(upsert)。apiKey 为空串时跳过(不覆盖已存非空,防误清)。
 */
export function saveLlmConfig(db: any, partial: Partial<{
  provider: string; apiKey: string; baseUrl: string; model: string; temperature: number | string
  capabilities: Partial<Record<LlmCapability, LlmCapabilityOverride>>
}>): void {
  const map: Record<string, string> = {}
  if (partial.provider !== undefined) map['llm.provider'] = partial.provider
  if (partial.apiKey !== undefined && partial.apiKey !== '') map['llm.apiKey'] = partial.apiKey
  if (partial.baseUrl !== undefined) map['llm.baseUrl'] = partial.baseUrl
  if (partial.model !== undefined) map['llm.model'] = partial.model
  if (partial.temperature !== undefined) map['llm.temperature'] = String(partial.temperature)
  if (partial.capabilities) {
    for (const [cap, ov] of Object.entries(partial.capabilities)) {
      if (ov?.model !== undefined) map[`llm.capability.${cap}.model`] = ov.model
      if (ov?.temperature !== undefined) map[`llm.capability.${cap}.temperature`] = String(ov.temperature)
    }
  }
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [k, v] of Object.entries(map)) upsert.run(k, v)
}

/** 纯函数:能力覆盖 > 顶层模型 */
export function resolveModelForCapability(cfg: LlmConfig, cap: LlmCapability): string {
  return cfg.capabilities[cap]?.model || cfg.model
}

export function listProviders(): Array<{ name: string; label: string; defaultBaseUrl: string; defaultModel: string }> {
  const labels: Record<ProviderName, string> = { deepseek: 'DeepSeek', qwen: '通义千问 Qwen', zhipu: '智谱 GLM' }
  return (Object.keys(PROVIDERS) as ProviderName[]).map((name) => ({
    name,
    label: labels[name],
    defaultBaseUrl: PROVIDERS[name].defaults.baseUrl,
    defaultModel: PROVIDERS[name].defaults.model,
  }))
}
