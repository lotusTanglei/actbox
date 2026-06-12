// src/lib/llm/client.ts

import OpenAI from 'openai'
import { PROVIDERS, type ProviderName } from './providers'

let _client: OpenAI | null = null
let _currentProvider: string | null = null

/** 获取或创建 OpenAI 兼容客户端（单例，按 provider 切换） */
export function getLlmClient(providerName?: ProviderName): OpenAI {
  const provider = providerName || (process.env.LLM_PROVIDER as ProviderName) || 'deepseek'
  const config = PROVIDERS[provider]

  if (!config) {
    throw new Error(
      `Unknown LLM provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(', ')}`
    )
  }

  // 如果 provider 没变，复用现有客户端
  if (_client && _currentProvider === provider) {
    return _client
  }

  const apiKey = process.env[config.apiKeyEnvVar]
  if (!apiKey) {
    throw new Error(`Missing API key: set ${config.apiKeyEnvVar} in .env.local`)
  }

  _client = new OpenAI({
    apiKey,
    baseURL: process.env[config.baseUrlEnvVar] || config.defaults.baseUrl,
  })

  _currentProvider = provider

  return _client
}

/** 获取当前 provider 的模型名 */
export function getModelName(providerName?: ProviderName): string {
  const provider = providerName || (process.env.LLM_PROVIDER as ProviderName) || 'deepseek'
  const config = PROVIDERS[provider]
  return process.env[config.modelEnvVar] || config.defaults.model
}
