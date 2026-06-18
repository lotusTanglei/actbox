// src/lib/llm/providers.ts

export interface LlmProviderConfig {
  apiKeyEnvVar: string
  baseUrlEnvVar: string
  modelEnvVar: string
  defaults: {
    baseUrl: string
    model: string
  }
}

export const DEFAULT_TEMPERATURE = 0.3

/** 支持的 LLM Provider 配置 */
export const PROVIDERS = {
  deepseek: {
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    baseUrlEnvVar: 'DEEPSEEK_BASE_URL',
    modelEnvVar: 'DEEPSEEK_MODEL',
    defaults: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    },
  },
  qwen: {
    apiKeyEnvVar: 'QWEN_API_KEY',
    baseUrlEnvVar: 'QWEN_BASE_URL',
    modelEnvVar: 'QWEN_MODEL',
    defaults: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    },
  },
  zhipu: {
    apiKeyEnvVar: 'ZHIPU_API_KEY',
    baseUrlEnvVar: 'ZHIPU_BASE_URL',
    modelEnvVar: 'ZHIPU_MODEL',
    defaults: {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
    },
  },
} as const

export type ProviderName = keyof typeof PROVIDERS

/** 校验 provider 名合法,否则抛错并附支持的列表 */
export function resolveProviderName(name?: string): ProviderName {
  if (name && name in PROVIDERS) return name as ProviderName
  throw new Error(`Unknown LLM provider: ${name}. Supported: ${Object.keys(PROVIDERS).join(', ')}`)
}
