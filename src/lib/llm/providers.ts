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

/** 支持的 LLM Provider 配置 */
export const PROVIDERS: Record<string, LlmProviderConfig> = {
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
}

export type ProviderName = keyof typeof PROVIDERS
