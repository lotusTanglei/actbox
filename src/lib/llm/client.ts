// src/lib/llm/client.ts — DB-first LLM client (per-capability model + provider|baseUrl cache)。plan-12 Task 1。
import OpenAI from 'openai'
import { getLlmConfig } from './config'
import { PROVIDERS, resolveProviderName, type ProviderName } from './providers'

export type LlmCapability = 'summarize' | 'polish' | 'classify' | 'extract' | 'reply'

const _clientCache = new Map<string, OpenAI>()

function cacheKey(provider: string, baseUrl: string): string {
  return `${provider}|${baseUrl}`
}

/**
 * 获取或创建 OpenAI 兼容客户端（按 provider+baseUrl 单例缓存）。
 * 配置 DB-first（getLlmConfig 读 settings），env 作 fallback。
 * 签名向后兼容：capability 和 db 均可选。
 */
export function getLlmClient(capability?: LlmCapability, db?: any): OpenAI {
  const cfg = getLlmConfig(db)
  const key = cacheKey(cfg.provider, cfg.baseUrl)
  const cached = _clientCache.get(key)
  if (cached) return cached
  if (!cfg.apiKey) {
    throw new Error('Missing API key: 请在设置页 LLM tab 配置 LLM API Key(或在 .env.local 设 DEEPSEEK_API_KEY/QWEN_API_KEY/ZHIPU_API_KEY)')
  }
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })
  _clientCache.set(key, client)
  return client
}

/** 清空客户端缓存（改配置后或测试隔离用） */
export function __resetLlmClientCache(): void {
  _clientCache.clear()
}

/**
 * 取当前模型名。capability 命中覆盖模型则用覆盖,否则用顶层默认模型。
 * 签名向后兼容：capability 和 db 均可选。
 */
export function getModelName(capability?: LlmCapability, db?: any): string {
  const cfg = getLlmConfig(db)
  const provider = resolveProviderName(cfg.provider)
  const fallback = cfg.model || PROVIDERS[provider].defaults.model
  if (capability && cfg.capabilities?.[capability]?.model) {
    return cfg.capabilities[capability].model!
  }
  return fallback
}
