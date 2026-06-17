# 子项目 12 — AI 增强 + LLM 配置中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把 LLM 配置从 env 只读升级为 DB 可配的多 provider 配置中心（连接测试 + 按能力切模型），并在现有 AI 草稿/润色/抽取之上新增 AI 邮件摘要、智能回复建议（2–3 选项）、智能分类打标三项能力，能力底层模型各自可插拔。

**Architecture:** 方案 B（详见 spec §0/子项目 12/NFR/风险登记册）。本地单机、单进程、单 SQLite(WAL)、单用户。分两层：
1. **配置层（DB-first + env fallback）**：LLM 配置由现状「`process.env` 只读 + 单例客户端」重构为「`getLlmConfig()` 优先读 settings 表（DB），env 作 fallback」。provider/模型/key/baseUrl/温度均落在 settings 表的 key-value（`llm.provider`/`llm.model`/`llm.apiKey`/`llm.baseUrl`/`llm.temperature` + 按能力覆盖 `llm.capability.<cap>.model`/`...temperature`）。`getLlmClient(capability?)` 与 `getModelName(capability?)` 增可选 `capability` 参数——按能力取覆盖模型，未配则回落默认模型；客户端单例按「provider+baseUrl」缓存（改配置即失效重建）。`/api/llm/config`（GET/PATCH）读写整组配置，`/api/llm/test` 用当前/给定配置跑一次最小补全验证连通。
2. **能力层（可测纯 prompt + provider 无关调用）**：参考 `src/lib/llm/polish.ts` 的 `buildPolishPrompt` 风格，把摘要/智能回复/打标的 system prompt 构造抽成纯函数（`buildSummarizePrompt`/`buildSuggestReplyPrompt`/`buildAutoTagPrompt`），输入可序列化、输出 `{ system, temperature }`，脱离 LLM/DB 单测；路由（`/api/summarize`、`/api/suggest-reply`、`/api/auto-tag`）只负责取消息正文 → 调纯函数拿 prompt → `getLlmClient(capability)` 调 `chat.completions.create` → 解析输出。`client.ts`/`getModelName` 重构后，现有 `/api/reply`、`/api/polish`、`/api/extract`、`src/lib/extractor` 透明复用（签名向后兼容，无 capability 参数即用默认模型）。

key 明文存 DB（本地硬约束，卫生同 auth_code：db 不入 git、不入未加密云同步）。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / OpenAI SDK（provider 无关，OpenAI 兼容协议）/ Drizzle ORM + better-sqlite3(WAL) / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 1（drizzle 迁移框架 + `settings` key-value 表已存在）、子项目 2（无强依赖，但 provider preset 复用思路）、**子项目 8（智能打标依赖 `labels`/`message_labels` 表与标签体系——`/api/auto-tag` 只产出建议标签名+优先级+重要度，落库交由 plan-08 的打标写入，本计划不建标签表）**。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。route handler 测试对 LLM client 用 `vi.mock('@/lib/llm/client')` 注入桩（不真实联网），对 `getDb()` 注入内存库（参考 plan-08 messages-batch.test.ts 与 plan-11 约定）。

---

## 文件结构

- Modify: `src/lib/llm/client.ts` — 重构 `getLlmClient(capability?)`/`getModelName(capability?)`：DB-first（读 settings）+ env fallback + 按能力取模型 + 单例缓存键改为 `provider|baseUrl`（Task 1）
- Modify: `src/lib/llm/providers.ts` — 增 `zhipu`(GLM) provider preset + `DEFAULT_TEMPERATURE` + provider 校验（Task 1 Step 1）
- Create: `src/lib/llm/config.ts` — `getLlmConfig()`/`saveLlmConfig()`/`resolveModelForCapability()`/`listProviders()`（settings 表读写，纯 DB，可注入 db 单测）（Task 2）
- Create: `src/lib/llm/prompts/summarize.ts` — `buildSummarizePrompt` 纯函数（Task 4）
- Create: `src/lib/llm/prompts/suggest-reply.ts` — `buildSuggestReplyPrompt` 纯函数（Task 5）
- Create: `src/lib/llm/prompts/auto-tag.ts` — `buildAutoTagPrompt` + 输出 JSON 解析 `parseAutoTagResult` 纯函数（Task 6）
- Create: `src/app/api/llm/config/route.ts` — GET/PATCH LLM 配置组（Task 3）
- Create: `src/app/api/llm/test/route.ts` — POST 连接测试（Task 3）
- Create: `src/app/api/summarize/route.ts` — POST 摘要（Task 4）
- Create: `src/app/api/suggest-reply/route.ts` — POST 智能回复建议（Task 5）
- Create: `src/app/api/auto-tag/route.ts` — POST 智能分类打标建议（Task 6）
- Modify: `src/app/settings/page.tsx` — LLM tab 改可编辑表单（provider 下拉/key/baseUrl/温度/各能力模型）+ 测试连通按钮（Task 8）
- Modify: `src/app/mails/[id]/page.tsx` — 摘要按钮 + 智能回复建议 + 一键打标建议（Task 9）
- Modify: `src/app/mails/page.tsx` — 列表行「AI 摘要」悬浮/快捷（Task 9 Step 4）
- Test: `src/__tests__/llm/config.test.ts`、`src/__tests__/llm/client.test.ts`、`src/__tests__/llm/prompts/summarize.test.ts`、`src/__tests__/llm/prompts/suggest-reply.test.ts`、`src/__tests__/llm/prompts/auto-tag.test.ts`、`src/__tests__/api/llm-config.test.ts`、`src/__tests__/api/llm-test.test.ts`、`src/__tests__/api/summarize.test.ts`、`src/__tests__/api/suggest-reply.test.ts`、`src/__tests__/api/auto-tag.test.ts`
- Create: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 建全列表（若 plan-08/11 已建则复用，本计划不重复建）

---

## 任务

### Task 1: 重构 getLlmClient/getModelName（DB-first + 按能力取模型 + 单例缓存键）

**Files:**
- Modify: `src/lib/llm/providers.ts`
- Modify: `src/lib/llm/client.ts`
- Create: `src/__tests__/llm/client.test.ts`

**关键设计：** 现状 `getLlmClient(providerName?)` 直接读 `process.env[config.apiKeyEnvVar]`、客户端单例按 `_currentProvider` 缓存。重构后：
- 配置来源统一走 `getLlmConfig()`（Task 2 实现，本 Task 先约定接口）：`{ provider, model, apiKey, baseUrl, temperature, capabilities: Record<Capability, {model?, temperature?}> }`。`getLlmConfig()` 先读 settings 表，缺失项回落 `PROVIDERS[provider].defaults` 与 env。
- `getLlmClient(capability?)`：读 config → 取 apiKey（无则抛「未配置 API key，请在设置页 LLM tab 配置」）→ 构造/复用客户端。**单例缓存键改为 `${provider}|${baseUrl}`**（不再是 provider 单例——改 baseUrl 必须重建）。注入 `db?` 参数供单测。
- `getModelName(capability?)`：`capability` 命中 `capabilities[cap].model` 则用之，否则用顶层 `model`（再回落 defaults）。
- 现有调用点（`/api/reply`、`/api/polish`、`/api/extract`、`src/lib/extractor`）无 `capability` 实参，行为不变（向后兼容）。
- providers 增 `zhipu`（智谱 GLM，OpenAI 兼容：baseUrl `https://open.bigmodel.cn/api/paas/v4`，默认模型 `glm-4-flash`）。

- [ ] **Step 1: providers.ts 增 zhipu + 默认温度**

```ts
// src/lib/llm/providers.ts —— 追加 zhipu + DEFAULT_TEMPERATURE
export const DEFAULT_TEMPERATURE = 0.3

export const PROVIDERS = {
  deepseek: {
    apiKeyEnvVar: 'DEEPSEEK_API_KEY', baseUrlEnvVar: 'DEEPSEEK_BASE_URL', modelEnvVar: 'DEEPSEEK_MODEL',
    defaults: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  },
  qwen: {
    apiKeyEnvVar: 'QWEN_API_KEY', baseUrlEnvVar: 'QWEN_BASE_URL', modelEnvVar: 'QWEN_MODEL',
    defaults: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  },
  zhipu: {
    apiKeyEnvVar: 'ZHIPU_API_KEY', baseUrlEnvVar: 'ZHIPU_BASE_URL', modelEnvVar: 'ZHIPU_MODEL',
    defaults: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  },
} as const

export type ProviderName = keyof typeof PROVIDERS

/** 校验 provider 名合法,否则抛错并附支持的列表 */
export function resolveProviderName(name?: string): ProviderName {
  if (name && name in PROVIDERS) return name as ProviderName
  throw new Error(`Unknown LLM provider: ${name}. Supported: ${Object.keys(PROVIDERS).join(', ')}`)
}
```

- [ ] **Step 2: 写失败测试**

```ts
// src/__tests__/llm/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OpenAI from 'openai'

// 用桩 config 模块,避免真实读 DB/env
vi.mock('@/lib/llm/config', () => {
  let cfg: any = { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com', temperature: 0.3, capabilities: {} }
  return {
    getLlmConfig: () => cfg,
    __setCfg: (c: any) => { cfg = { ...cfg, ...c } },
  }
})

import { getLlmClient, getModelName } from '@/lib/llm/client'
const { __setCfg } = require('@/lib/llm/config') as any

describe('getLlmClient — DB-first + 单例缓存', () => {
  beforeEach(() => { __setCfg({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com', temperature: 0.3, capabilities: {} }) })

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
```

- [ ] **Step 3: 运行确认失败** `npx vitest run src/__tests__/llm/client.test.ts` → FAIL（接口不匹配）。

- [ ] **Step 4: 重构 client.ts**

```ts
// src/lib/llm/client.ts
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
```

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: 回归现有调用** `npx vitest run src/__tests__/llm/ src/__tests__/extractor/` → PASS（polish/extractor 仍绿，因无 capability 实参）。`npx tsc --noEmit` → 无类型错误（确认 `/api/reply`、`/api/polish`、`/api/extract`、`src/lib/extractor/index.ts` 的 `getLlmClient()`/`getModelName()` 调用签名兼容）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm/client.ts src/lib/llm/providers.ts src/__tests__/llm/client.test.ts
git commit -m "feat(llm): DB-first getLlmClient/getModelName with per-capability model + zhipu provider"
git push
```

---

### Task 2: config.ts（settings 表读写 + 按能力解析）

**Files:**
- Create: `src/lib/llm/config.ts`
- Create: `src/__tests__/llm/config.test.ts`

**关键设计：** settings 表是 `key TEXT PRIMARY KEY, value TEXT NOT NULL`（已存在）。LLM 配置 key 命名（**spec 数据模型：provider/model/key/temperature 按能力分组**）：
- `llm.provider`（`deepseek`|`qwen`|`zhipu`）
- `llm.apiKey`（明文）
- `llm.baseUrl`（覆盖 provider defaults）
- `llm.model`（顶层默认模型）
- `llm.temperature`（顶层默认温度，string 存数字）
- `llm.capability.<cap>.model` / `llm.capability.<cap>.temperature`（按能力覆盖，`<cap>` ∈ `summarize`/`polish`/`classify`/`extract`/`reply`）

`getLlmConfig(db?)`：读 settings（注入 db 可单测）→ 缺失项用 `PROVIDERS[provider].defaults` + env（`process.env[apiKeyEnvVar]` 等）补齐 → 返回规整 `LlmConfig`。`saveLlmConfig(db, partial)`：upsert 一组 key-value（API key 为空串时跳过——不覆盖已存非空 key，避免误清空）。`resolveModelForCapability(cfg, cap)` 纯函数：能力覆盖 > 顶层 > defaults。`listProviders()` 返回 `{ name, label, defaultBaseUrl, defaultModel }[]` 供 UI 下拉。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getLlmConfig, saveLlmConfig, resolveModelForCapability, listProviders } from '@/lib/llm/config'
import { memDb } from '../helpers/memDb'

describe('getLlmConfig — DB-first + env fallback', () => {
  let db: any
  beforeEach(() => { db = memDb() })

  it('空 settings → 回落 provider defaults', () => {
    const cfg = getLlmConfig(db)
    expect(cfg.provider).toBe('deepseek') // 默认 provider
    expect(cfg.baseUrl).toBe('https://api.deepseek.com')
    expect(cfg.model).toBe('deepseek-v4-flash')
  })
  it('DB 存 llm.* 优先于 defaults', () => {
    db.prepare("INSERT INTO settings (key,value) VALUES ('llm.provider','qwen'),('llm.model','qwen-turbo'),('llm.apiKey','sk-q'),('llm.temperature','0.7')")
      .run()
    const cfg = getLlmConfig(db)
    expect(cfg.provider).toBe('qwen')
    expect(cfg.model).toBe('qwen-turbo')
    expect(cfg.apiKey).toBe('sk-q')
    expect(cfg.temperature).toBe(0.7)
  })
  it('capabilities 按能力解析 model/temperature', () => {
    db.prepare("INSERT INTO settings (key,value) VALUES ('llm.capability.summarize.model','glm-4-flash'),('llm.capability.classify.temperature','0.1')")
      .run()
    const cfg = getLlmConfig(db)
    expect(cfg.capabilities.summarize.model).toBe('glm-4-flash')
    expect(cfg.capabilities.classify.temperature).toBe(0.1)
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
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/llm/config.ts
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
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
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
```

> 注：若 better-sqlite3 版本不支持 `ON CONFLICT ... DO UPDATE`（SQLite ≥ 3.24，better-sqlite3 内置支持），则退化为「SELECT 存在 → UPDATE / 否则 INSERT」两步（与现状 `/api/settings` PATCH 一致）。

- [ ] **Step 4: 运行确认通过** → PASS（Task 1 的 client.test.ts 此时也绿，因 `@/lib/llm/config` 已真实存在——若 Task 1 的 `vi.mock` 与本任务冲突，client.test.ts 保持 mock 桩不变即可，两测试互不影响）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/config.ts src/__tests__/llm/config.test.ts
git commit -m "feat(llm): config repo (DB-first settings read/write + per-capability resolution)"
git push
```

---

### Task 3: /api/llm/config（GET/PATCH）+ /api/llm/test（连接测试）

**Files:**
- Create: `src/app/api/llm/config/route.ts`
- Create: `src/app/api/llm/test/route.ts`
- Create: `src/__tests__/api/llm-config.test.ts`
- Create: `src/__tests__/api/llm-test.test.ts`

**关键设计：**
- `GET /api/llm/config`：返回 `getLlmConfig()`（**apiKey 脱敏**：返回 `apiKeyMasked`（如 `sk-***xyz`）+ `apiKeySet: boolean`，不回传明文 key 到前端防止在页面源/日志泄露——前端编辑时若不改 key 则不回传）。同时返回 `listProviders()` 供下拉。
- `PATCH /api/llm/config`：body 为部分配置对象 → `saveLlmConfig(db, partial)` → 清 `__resetLlmClientCache()`（让后续调用用新配置）。
- `POST /api/llm/test`：body 可含临时配置（用户填了 key 还没保存想先测）或省略（测已存配置）。用临时/已存配置构造一次性 `OpenAI` 客户端 → 发一条最小 `chat.completions.create`（model 用配置模型，messages 一条 `[{role:'user',content:'ping'}]`，max_tokens 1）→ 成功返回 `{ ok:true, latencyMs, model }`；失败返回 `{ ok:false, error }`（区分 401 key 错 / 网络错 / 超时，HTTP 仍 200 把详情给前端，不抛 5xx）。

- [ ] **Step 1: 写失败测试（config）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from '@/app/api/llm/config/route'
import { memDb } from '../helpers/memDb'

vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })

describe('GET /api/llm/config', () => {
  beforeEach(() => { const db = memDb(); db.exec("INSERT INTO settings (key,value) VALUES ('llm.provider','zhipu'),('llm.apiKey','sk-secret123'),('llm.model','glm-4')"); (require('@/lib/db') as any).__setDb(db) })
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
  beforeEach(() => { (require('@/lib/db') as any).__setDb(memDb()) })
  it('保存配置', async () => {
    const res = await PATCH(new Request('http://x/api/llm/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'qwen', apiKey: 'sk-q', model: 'qwen-plus' }) }))
    expect(res.status).toBe(200)
    const db = (require('@/lib/db') as any).getDb()
    expect((db.prepare("SELECT value FROM settings WHERE key='llm.provider'").get() as any).value).toBe('qwen')
  })
  it('空 apiKey 不清空已存', async () => {
    const db = (require('@/lib/db') as any).getDb()
    db.exec("INSERT INTO settings (key,value) VALUES ('llm.apiKey','keep')")
    await PATCH(new Request('http://x/api/llm/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) }))
    expect((db.prepare("SELECT value FROM settings WHERE key='llm.apiKey'").get() as any).value).toBe('keep')
  })
})
```

- [ ] **Step 2: 写失败测试（test 端点）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/llm/test/route'
import { memDb } from '../helpers/memDb'

vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })

const makeClient = (ok: boolean, err?: any) => ({
  chat: { completions: { create: vi.fn(ok ? () => ({ choices: [{ message: { content: 'pong' } }] }) : () => { throw err || new Error('boom') }) } },
})

describe('POST /api/llm/test', () => {
  beforeEach(() => { (require('@/lib/db') as any).__setDb(memDb()) })

  it('连通成功 → ok:true + latencyMs + model', async () => {
    vi.doMock('openai', () => ({ default: class { constructor() { return makeClient(true) } }))
    const res = await POST(new Request('http://x/api/llm/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'zhipu', apiKey: 'sk-z', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }) }))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.model).toBe('glm-4-flash')
    expect(typeof j.latencyMs).toBe('number')
    vi.doUnmock('openai')
  })
  it('401 key 错 → ok:false + error 含认证信息', async () => {
    vi.doMock('openai', () => ({ default: class { constructor() { return makeClient(false, Object.assign(new Error('Incorrect API key provided'), { status: 401 })) } }))
    const j = await (await POST(new Request('http://x/api/llm/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'zhipu', apiKey: 'bad', baseUrl: 'x', model: 'glm-4-flash' }) }))).json()
    expect(j.ok).toBe(false)
    expect(j.error).toMatch(/api key|认证|401/i)
    vi.doUnmock('openai')
  })
  it('缺 apiKey → ok:false 明确提示', async () => {
    const j = await (await POST(new Request('http://x/api/llm/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'zhipu', apiKey: '', baseUrl: 'x', model: 'm' }) }))).json()
    expect(j.ok).toBe(false)
    expect(j.error).toMatch(/api key/i)
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `/api/llm/config/route.ts`**

```ts
// src/app/api/llm/config/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmConfig, saveLlmConfig, listProviders } from '@/lib/llm/config'
import { __resetLlmClientCache } from '@/lib/llm/client'

function mask(key: string): { masked: string; set: boolean } {
  if (!key) return { masked: '', set: false }
  if (key.length <= 8) return { masked: '*'.repeat(key.length), set: true }
  return { masked: `${key.slice(0, 4)}***${key.slice(-3)}`, set: true }
}

export async function GET() {
  const cfg = getLlmConfig(getDb())
  const { masked, set } = mask(cfg.apiKey)
  return NextResponse.json({
    config: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      capabilities: cfg.capabilities,
      apiKeyMasked: masked,
      apiKeySet: set,
    },
    providers: listProviders(),
  })
}

export async function PATCH(req: Request) {
  const body = await req.json()
  saveLlmConfig(getDb(), body)
  __resetLlmClientCache()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: 实现 `/api/llm/test/route.ts`**

```ts
// src/app/api/llm/test/route.ts
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getDb } from '@/lib/db'
import { getLlmConfig } from '@/lib/llm/config'
import { PROVIDERS, resolveProviderName } from '@/lib/llm/providers'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  // 优先用请求体里的临时配置(用户还没保存想先测),否则读已存
  const stored = getLlmConfig(getDb())
  const provider = body.provider || stored.provider
  const apiKey = body.apiKey !== undefined ? body.apiKey : stored.apiKey
  const baseUrl = body.baseUrl || stored.baseUrl
  const model = body.model || stored.model

  if (!apiKey) return NextResponse.json({ ok: false, error: '未配置 API key,请先填写 LLM API Key' })

  const client = new OpenAI({ apiKey, baseURL: baseUrl })
  const t0 = Date.now()
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    })
    return NextResponse.json({ ok: true, latencyMs: Date.now() - t0, model, provider })
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status
    const msg = status === 401 ? `API key 认证失败(401):${e.message || ''}` : status === 404 ? `模型/端点不存在(404):${e.message || ''}` : `连接失败:${e.message || String(e)}`
    return NextResponse.json({ ok: false, error: msg, latencyMs: Date.now() - t0, provider, model })
  }
}
```

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/llm/config/route.ts src/app/api/llm/test/route.ts src/__tests__/api/llm-config.test.ts src/__tests__/api/llm-test.test.ts
git commit -m "feat(api): LLM config center (GET/PATCH + connection test with masked key)"
git push
```

---

### Task 4: AI 邮件摘要（buildSummarizePrompt 纯函数 + /api/summarize）

**Files:**
- Create: `src/lib/llm/prompts/summarize.ts`
- Create: `src/app/api/summarize/route.ts`
- Create: `src/__tests__/llm/prompts/summarize.test.ts`
- Create: `src/__tests__/api/summarize.test.ts`

**关键设计：** `buildSummarizePrompt({ subject, from, body, style })` 纯函数返回 `{ system, temperature }`，参考 `buildPolishPrompt` 风格。`style ∈ 'brief'(一句话)|'bullet'(3-5 要点)|'normal'(2-3 句)`。超长正文截断到 `SUMMARIZE_MAX_CHARS=12000`（路由侧截断）。system prompt 指示：中文输出、不超过要点数、不编造、聚焦可行动信息。路由 `POST /api/summarize`：body `{ messageId }` 或 `{ subject, from, body }` → 取消息（按 id 查库取 body）→ 截断 → `buildSummarizePrompt` → `getLlmClient('summarize')` + `getModelName('summarize')` → 返回 `{ summary }`。LLM client 用 `vi.mock` 桩。

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
import { describe, it, expect } from 'vitest'
import { buildSummarizePrompt, SUMMARIZE_MAX_CHARS } from '@/lib/llm/prompts/summarize'

describe('buildSummarizePrompt', () => {
  it('normal 风格:system 含 2-3 句 + 中文指示', () => {
    const { system, temperature } = buildSummarizePrompt({ subject: 'S', from: 'a@b', body: '正文', style: 'normal' })
    expect(system).toMatch(/2.*3|两到三/i)
    expect(system).toMatch(/中文/)
    expect(temperature).toBeGreaterThan(0)
  })
  it('brief 风格:一句话', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'brief' })
    expect(system).toMatch(/一句话|一句/)
  })
  it('bullet 风格:3-5 要点', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'bullet' })
    expect(system).toMatch(/3.*5|三到五|要点/)
  })
  it('指示不编造 + 可行动信息', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'normal' })
    expect(system).toMatch(/不要编造|如实/)
  })
  it('默认 normal', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/中文/)
  })
  it('SUMMARIZE_MAX_CHARS 上限存在', () => {
    expect(SUMMARIZE_MAX_CHARS).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 2: 写失败测试（API）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@/lib/llm/client', () => ({
  getLlmClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getModelName: () => 'sum-model',
}))
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })

import { POST } from '@/app/api/summarize/route'
import { memDb } from '../../helpers/memDb'

describe('POST /api/summarize', () => {
  beforeEach(() => { const db = memDb(); db.exec(`INSERT INTO messages (id,message_id,account_id,sender,subject,body,folder,imap_uid) VALUES (1,'<m>',1,'a@b','关于项目进度','很长的正文','INBOX',1)`); (require('@/lib/db') as any).__setDb(db); mockCreate.mockReset() })

  it('按 messageId 取正文生成摘要', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '项目进度正常,本周交付模块 A。' } }] })
    const j = await (await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))).json()
    expect(j.summary).toContain('项目进度')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'sum-model', messages: expect.any(Array) }))
  })
  it('用 summarize 能力的模型', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 's' } }] })
    await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 1 }) }))
    // getModelName 桩固定返回 sum-model,验证用对能力
    expect(mockCreate.mock.calls[0][0].model).toBe('sum-model')
  })
  it('消息不存在 → 404', async () => {
    const res = await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 999 }) }))
    expect(res.status).toBe(404)
  })
  it('缺 messageId 且无 body → 400', async () => {
    const res = await POST(new Request('http://x/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现纯函数 `src/lib/llm/prompts/summarize.ts`**

```ts
// src/lib/llm/prompts/summarize.ts
export type SummarizeStyle = 'brief' | 'bullet' | 'normal'
export const SUMMARIZE_MAX_CHARS = 12000

const STYLE_INSTRUCTION: Record<SummarizeStyle, string> = {
  brief: '用一句话概括邮件核心(不超过 40 字)',
  bullet: '用 3 到 5 个要点概括,每点一行,以「•」开头',
  normal: '用 2 到 3 句话概括邮件主要内容与需采取的行动',
}

export interface SummarizeInput {
  subject?: string
  from?: string
  body: string
  style?: SummarizeStyle
}

export function buildSummarizePrompt(input: SummarizeInput): { system: string; temperature: number } {
  const style = input.style || 'normal'
  return {
    system: `你是一个邮件摘要助手。要求:${STYLE_INSTRUCTION[style]}。用中文输出。如实概括邮件已有内容,不要编造、不要补充邮件未提及的信息。聚焦可行动信息(谁需要在何时做什么)。直接返回摘要纯文本,不要 JSON、不要解释、不要前后缀。`,
    temperature: 0.2,
  }
}
```

- [ ] **Step 5: 实现 `src/app/api/summarize/route.ts`**

```ts
// src/app/api/summarize/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import { buildSummarizePrompt, SUMMARIZE_MAX_CHARS } from '@/lib/llm/prompts/summarize'

export async function POST(req: Request) {
  const body = await req.json()
  const db = getDb()
  let subject = body.subject, from = body.from, text = body.body as string | undefined

  if (body.messageId) {
    const m = db.prepare('SELECT sender, subject, body FROM messages WHERE id = ?').get(Number(body.messageId)) as any
    if (!m) return NextResponse.json({ error: 'message not found' }, { status: 404 })
    subject = m.subject; from = m.sender; text = m.body
  }
  if (!text) return NextResponse.json({ error: 'Missing messageId or body' }, { status: 400 })

  const truncated = text.slice(0, SUMMARIZE_MAX_CHARS)
  const { system, temperature } = buildSummarizePrompt({ subject, from, body: truncated, style: body.style })
  const client = getLlmClient('summarize')
  const model = getModelName('summarize')
  const resp = await client.chat.completions.create({
    model, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `发件人:${from || '(无)'}\n主题:${subject || '(无主题)'}\n正文:\n${truncated}` }],
  })
  const summary = resp.choices[0]?.message?.content || ''
  return NextResponse.json({ summary })
}
```

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm/prompts/summarize.ts src/app/api/summarize/route.ts src/__tests__/llm/prompts/summarize.test.ts src/__tests__/api/summarize.test.ts
git commit -m "feat(ai): email summarize (buildSummarizePrompt pure fn + /api/summarize)"
git push
```

---

### Task 5: 智能回复建议（buildSuggestReplyPrompt + /api/suggest-reply）

**Files:**
- Create: `src/lib/llm/prompts/suggest-reply.ts`
- Create: `src/app/api/suggest-reply/route.ts`
- Create: `src/__tests__/llm/prompts/suggest-reply.test.ts`
- Create: `src/__tests__/api/suggest-reply.test.ts`

**关键设计：** `buildSuggestReplyPrompt({ subject, from, body, count })` 纯函数返回 `{ system, temperature }`。要求模型输出严格 JSON 数组：`[{ "text": "...", "tone": "同意|委婉拒绝|询问详情|致谢" }]`，`count` 默认 3（2–3 个简短选项，每条 ≤ 50 字）。`parseSuggestReplyResult(raw)` 纯函数：容错解析 LLM 返回（剥 markdown ```json 围栏、取第一个 `[...]`、失败返回空数组）。路由用 `getLlmClient('reply')`。

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
import { describe, it, expect } from 'vitest'
import { buildSuggestReplyPrompt, parseSuggestReplyResult } from '@/lib/llm/prompts/suggest-reply'

describe('buildSuggestReplyPrompt', () => {
  it('system 指示输出 JSON 数组 + 条数', () => {
    const { system } = buildSuggestReplyPrompt({ subject: 'S', body: 'b', count: 3 })
    expect(system).toMatch(/JSON/)
    expect(system).toMatch(/3.*条|2.*3|两条|三条/)
  })
  it('每条简短(≤50 字)', () => {
    const { system } = buildSuggestReplyPrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/50|简短/)
  })
  it('中文回复指示', () => {
    expect(buildSuggestReplyPrompt({ body: 'b' }).system).toMatch(/中文/)
  })
})

describe('parseSuggestReplyResult', () => {
  it('解析合法 JSON 数组', () => {
    const r = parseSuggestReplyResult('[{"text":"好的","tone":"同意"}]')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('好的')
  })
  it('剥 ```json 围栏', () => {
    const r = parseSuggestReplyResult('```json\n[{"text":"ok","tone":"同意"}]\n```')
    expect(r).toHaveLength(1)
  })
  it('从混合文本提取第一个数组', () => {
    const r = parseSuggestReplyResult('以下是建议:\n[{"text":"hi","tone":"致谢"}]\n谢谢')
    expect(r).toHaveLength(1)
  })
  it('非法输入 → 空数组(不抛)', () => {
    expect(parseSuggestReplyResult('not json')).toEqual([])
    expect(parseSuggestReplyResult('')).toEqual([])
  })
})
```

- [ ] **Step 2: 写失败测试（API）**（模式同 summarize：mock client 返回 `[{...}]` 字符串，断言 `j.suggestions` 为数组、用 `reply` 能力模型、404/400）。

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `src/lib/llm/prompts/suggest-reply.ts`**

```ts
// src/lib/llm/prompts/suggest-reply.ts
export interface ReplySuggestion {
  text: string
  tone: '同意' | '委婉拒绝' | '询问详情' | '致谢' | '其他'
}

export function buildSuggestReplyPrompt(input: { subject?: string; from?: string; body: string; count?: number }): { system: string; temperature: number } {
  const count = input.count && input.count >= 2 && input.count <= 3 ? input.count : 3
  return {
    system: `你是一个邮件快速回复助手。根据原邮件生成 ${count} 条简短回复选项(每条不超过 50 字),覆盖不同立场(如同意/委婉拒绝/询问详情/致谢)。用中文。
严格只输出一个 JSON 数组,格式:[{"text":"回复正文","tone":"同意|委婉拒绝|询问详情|致谢|其他"}]。不要 markdown 围栏、不要解释、不要前后缀。`,
    temperature: 0.6,
  }
}

export function parseSuggestReplyResult(raw: string): ReplySuggestion[] {
  if (!raw) return []
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const tryParse = (s: string): ReplySuggestion[] | null => {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return arr.filter((x) => x && typeof x.text === 'string').map((x) => ({ text: String(x.text), tone: x.tone || '其他' }))
    } catch { /* noop */ }
    return null
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  // 从混合文本抽第一个 [...] 段
  const m = cleaned.match(/\[[\s\S]*\]/)
  return m ? (tryParse(m[0]) || []) : []
}
```

- [ ] **Step 5: 实现 `src/app/api/suggest-reply/route.ts`**（同 summarize 结构：取正文 → `buildSuggestReplyPrompt` → `getLlmClient('reply')`/`getModelName('reply')` → `parseSuggestReplyResult(content)` → `{ suggestions }`；404/400 同）。

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm/prompts/suggest-reply.ts src/app/api/suggest-reply/route.ts src/__tests__/llm/prompts/suggest-reply.test.ts src/__tests__/api/suggest-reply.test.ts
git commit -m "feat(ai): smart reply suggestions (buildSuggestReplyPrompt pure fn + /api/suggest-reply)"
git push
```

---

### Task 6: 智能分类打标（buildAutoTagPrompt + parseAutoTagResult + /api/auto-tag）

**Files:**
- Create: `src/lib/llm/prompts/auto-tag.ts`
- Create: `src/app/api/auto-tag/route.ts`
- Create: `src/__tests__/llm/prompts/auto-tag.test.ts`
- Create: `src/__tests__/api/auto-tag.test.ts`

**关键设计：** `buildAutoTagPrompt({ subject, from, body, availableLabels })` 纯函数。`availableLabels?: string[]` 是用户已有标签（plan-08 `labels` 表）——传给模型优先复用既有标签，无既有则建议新标签名。输出严格 JSON：`{ "labels": ["工作","待付款"], "priority": "high|normal|low", "importance": "important|normal", "reason": "简短理由" }`。`parseAutoTagResult(raw)` 容错解析（剥围栏、取 `{...}`、字段缺失给默认）。路由 `POST /api/auto-tag`：body `{ messageId }` → 取消息 + 查 `labels` 表（plan-08）拿 `availableLabels` → prompt → `getLlmClient('classify')` → 返回建议（**只产出建议，不写 message_labels**；落库交前端调 plan-08 打标接口，本计划不碰标签表写入）。

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
import { describe, it, expect } from 'vitest'
import { buildAutoTagPrompt, parseAutoTagResult } from '@/lib/llm/prompts/auto-tag'

describe('buildAutoTagPrompt', () => {
  it('指示输出 JSON 含 labels/priority/importance', () => {
    const { system } = buildAutoTagPrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/labels/)
    expect(system).toMatch(/priority/)
    expect(system).toMatch(/importance/)
  })
  it('优先复用既有标签', () => {
    const { system } = buildAutoTagPrompt({ subject: 'S', body: 'b', availableLabels: ['工作', '账单'] })
    expect(system).toMatch(/工作|账单/)
    expect(system).toMatch(/优先|复用|已有/)
  })
  it('priority 取值约束', () => {
    expect(buildAutoTagPrompt({ body: 'b' }).system).toMatch(/high|normal|low/)
  })
})

describe('parseAutoTagResult', () => {
  it('解析合法对象', () => {
    const r = parseAutoTagResult('{"labels":["工作"],"priority":"high","importance":"important","reason":"紧急"}')
    expect(r.labels).toEqual(['工作'])
    expect(r.priority).toBe('high')
    expect(r.importance).toBe('important')
  })
  it('剥围栏', () => {
    const r = parseAutoTagResult('```json\n{"labels":[],"priority":"normal","importance":"normal"}\n```')
    expect(r.priority).toBe('normal')
  })
  it('字段缺失 → 默认', () => {
    const r = parseAutoTagResult('{}')
    expect(r.labels).toEqual([])
    expect(r.priority).toBe('normal')
    expect(r.importance).toBe('normal')
  })
  it('非法 → 默认对象(不抛)', () => {
    const r = parseAutoTagResult('xx')
    expect(r.labels).toEqual([])
  })
})
```

- [ ] **Step 2: 写失败测试（API）**：mock client 返回 JSON 串；mock `getDb` 返回含 messages 行 + labels 表（`INSERT INTO labels ...`）行；断言 `j.labels/priority/importance`、用 `classify` 能力模型、404/400。

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `src/lib/llm/prompts/auto-tag.ts`**

```ts
// src/lib/llm/prompts/auto-tag.ts
export type Priority = 'high' | 'normal' | 'low'
export type Importance = 'important' | 'normal'
export interface AutoTagResult {
  labels: string[]
  priority: Priority
  importance: Importance
  reason?: string
}

export function buildAutoTagPrompt(input: { subject?: string; from?: string; body: string; availableLabels?: string[] }): { system: string; temperature: number } {
  const labelsHint = input.availableLabels && input.availableLabels.length > 0
    ? `用户已有标签:[${input.availableLabels.join(', ')}]。优先从已有标签中选取,仅当都不合适时才建议一个简短新标签名。`
    : '建议 1-3 个简短中文标签名。'
  return {
    system: `你是一个邮件分类助手。根据邮件内容建议标签、优先级、重要度。${labelsHint}
严格只输出一个 JSON 对象:{"labels":["标签名"],"priority":"high|normal|low","importance":"important|normal","reason":"一句话理由"}。
priority: high=需尽快处理(截止/紧急/重要客户), normal=常规, low=通知/广播。importance: important=高价值需关注, normal=普通。不要 markdown 围栏、不要解释、不要前后缀。`,
    temperature: 0.2,
  }
}

export function parseAutoTagResult(raw: string): AutoTagResult {
  const fallback: AutoTagResult = { labels: [], priority: 'normal', importance: 'normal' }
  if (!raw) return fallback
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const extract = (s: string): any | null => {
    try { return JSON.parse(s) } catch { /* noop */ }
    const m = s.match(/\{[\s\S]*\}/)
    if (m) { try { return JSON.parse(m[0]) } catch { /* noop */ } }
    return null
  }
  const o = extract(cleaned)
  if (!o || typeof o !== 'object') return fallback
  const pri = ['high', 'normal', 'low'].includes(o.priority) ? o.priority : 'normal'
  const imp = ['important', 'normal'].includes(o.importance) ? o.importance : 'normal'
  const labels = Array.isArray(o.labels) ? o.labels.filter((x: any) => typeof x === 'string').map((x: any) => String(x)) : []
  return { labels, priority: pri as Priority, importance: imp as Importance, reason: typeof o.reason === 'string' ? o.reason : undefined }
}
```

- [ ] **Step 5: 实现 `src/app/api/auto-tag/route.ts`**（结构：取消息 → 查 `labels` 表 `SELECT name FROM labels`（plan-08，若表不存在则 `availableLabels=[]`，try/catch）→ `buildAutoTagPrompt` → `getLlmClient('classify')`/`getModelName('classify')` → `parseAutoTagResult` → `{ labels, priority, importance, reason }`；404/400）。

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm/prompts/auto-tag.ts src/app/api/auto-tag/route.ts src/__tests__/llm/prompts/auto-tag.test.ts src/__tests__/api/auto-tag.test.ts
git commit -m "feat(ai): auto-tag suggestions (buildAutoTagPrompt pure fn + /api/auto-tag, depends plan-08 labels)"
git push
```

---

### Task 7: 把现有 AI 入口迁移到 DB-first 配置（向后兼容验证）

**Files:**
- Modify: `src/app/api/reply/route.ts`、`src/app/api/polish/route.ts`、`src/app/api/extract/route.ts`、`src/lib/extractor/index.ts`
- Test: 复用现有 `src/__tests__/llm/polish.test.ts`、`src/__tests__/extractor/*`

**关键设计：** Task 1 已让 `getLlmClient()`/`getModelName()` 向后兼容（无 capability 实参走默认）。本任务把现有入口的 `temperature` 从硬编码改为读 `getLlmConfig().temperature`（统一温度来源），并确认它们在「settings 配了 provider/model」时用 DB 配置而非 env——不逐个加 capability（reply/polish/extract 默认即顶层模型，除非用户在设置页为这些能力单独配模型，届时 `getModelName('reply')` 才生效）。**改动最小**：`/api/reply` 的 `temperature: 0.3` 改为 `temperature: cfg.temperature`（cfg 来自 `getLlmConfig(getDb())`）；其余同理。

- [ ] **Step 1: 改 `/api/reply/route.ts`**：`import { getLlmConfig } from '@/lib/llm/config'`；`const cfg = getLlmConfig(getDb())`；`getLlmClient()` / `getModelName()`（无 capability，用顶层）；`temperature: cfg.temperature`。

- [ ] **Step 2: 改 `/api/polish/route.ts`、`/api/extract/route.ts`、`src/lib/extractor/index.ts`** 同样：保留各自 `buildPolishPrompt`/`getSystemPrompt` 产出的 system，但 `chat.completions.create` 的 `model`/`temperature` 用 `getModelName()`/`cfg.temperature`（polish 若 `buildPolishPrompt` 返回了特定温度则优先用 prompt 温度，保持现状）。

- [ ] **Step 3: 回归测试** `npx vitest run src/__tests__/llm/ src/__tests__/extractor/` → PASS。`npx tsc --noEmit` → 无错误。

- [ ] **Step 4: 手测**：设置页把 provider 切到 zhipu + 填 key（Task 8 后），草稿回复/润色/抽取仍能跑通（证明 DB-first 生效）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/reply/route.ts src/app/api/polish/route.ts src/app/api/extract/route.ts src/lib/extractor/index.ts
git commit -m "refactor(llm): migrate existing AI endpoints to DB-first config (back-compat, unified temperature)"
git push
```

---

### Task 8: 设置页 LLM 配置 UI（可编辑 + 连接测试）

**Files:**
- Modify: `src/app/settings/page.tsx`

**关键设计：** 现状 LLM section 是「env 只读 + 显示 LLM_PROVIDER」的只读块。改为可编辑表单：
- Provider 下拉（`listProviders()` 的 name+label）→ 选中自动填默认 baseUrl/model。
- API Key 输入框（`type=password`），占位显示 `apiKeyMasked`（如 `sk-***xyz`），用户可清空重填；旁边「眼睛」切换可见。
- baseUrl、model、temperature（滑块 0–1）输入。
- **各能力模型覆盖区**：折叠面板，列出 summarize/polish/classify/extract/reply，每项一个 model 输入（留空=用顶层默认）+ temperature。
- 「测试连通」按钮 → `POST /api/llm/test`（带当前表单值，先测不保存）→ 显示 `ok`/`latencyMs`/`error`。
- 「保存」按钮 → `PATCH /api/llm/config`（带表单值，apiKey 空串不回传）→ 成功提示。

- [ ] **Step 1: 加载配置**：页面 mount 调 `GET /api/llm/config` → 填充表单（provider/model/baseUrl/temperature/capabilities + apiKeyMasked + apiKeySet）。

- [ ] **Step 2: Provider 切换**：下拉 onChange → 取对应 provider 的 `defaultBaseUrl`/`defaultModel` 填入（用户可再改）。

- [ ] **Step 3: 测试连通**：按钮 onClick → `fetch('/api/llm/test', { method:'POST', body: JSON.stringify({provider, apiKey, baseUrl, model}) })`（apiKey 为空且 apiKeySet=true 时传空，由后端读已存）→ 渲染结果条（绿「连通成功,延迟 Xms,模型 Y」/红 error）。

- [ ] **Step 4: 保存**：按钮 onClick → 收集表单 → `PATCH /api/llm/config`（apiKey 空串则不带该字段）→ toast「已保存」+ 重新 GET 刷新 masked。

- [ ] **Step 5: 手测**：切 deepseek→zhipu + 填真实 key + 测试连通（绿）→ 保存 → 刷新页面 masked 正确；能力区给 summarize 配不同模型 → 保存 → 调 `/api/summarize` 确认用了该模型（后端日志/桩验证）。

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(ui): editable LLM config center (provider/key/model/temp + per-capability model + connection test)"
git push
```

---

### Task 9: 邮件列表/详情接入 AI 能力（摘要 + 智能回复 + 打标）

**Files:**
- Modify: `src/app/mails/[id]/page.tsx`
- Modify: `src/app/mails/page.tsx`

**关键设计：**
- **详情页**：
  - 「AI 摘要」按钮 → `POST /api/summarize { messageId }` → 在正文上方显示摘要块（带 style 切换 brief/bullet/normal 重生成）。长邮件（body 长度阈值，如 > 800 字）才显示按钮，短邮件隐藏。
  - 「智能回复建议」按钮（回复区旁）→ `POST /api/suggest-reply { messageId }` → 显示 2–3 个选项卡片，点击即填入回复正文编辑器（复用 plan-10/现有 RichTextEditor）。
  - 「智能打标」按钮 → `POST /api/auto-tag { messageId }` → 弹出建议（labels 芯片可点应用、priority/importance 徽标预览）；「应用标签」按钮调 plan-08 的打标接口（`POST /api/messages/[id]/labels`）写入 `message_labels`——本计划只做建议展示 + 触发应用，标签写入端点依赖 plan-08。
- **列表页**：每行悬浮显示「AI 摘要」快捷（鼠标悬停或行尾按钮）→ `POST /api/summarize { messageId, style:'brief' }` → tooltip/popover 显示一句话摘要。

- [ ] **Step 1: 详情页摘要块**（按钮 + 调 `/api/summarize` + style 切换 + loading/error 态）。

- [ ] **Step 2: 详情页智能回复建议**（按钮 + 调 `/api/suggest-reply` + 选项卡片点击填入编辑器）。

- [ ] **Step 3: 详情页智能打标建议**（按钮 + 调 `/api/auto-tag` + 标签/优先级/重要度展示 + 「应用」调 plan-08 打标接口；若 plan-08 未就绪则建议只读展示，按钮禁用并 tooltip 提示「需标签系统」）。

- [ ] **Step 4: 列表页行内摘要**（行尾「AI 摘要」按钮 → brief 摘要 popover）。

- [ ] **Step 5: 手测**：一封长邮件 → AI 摘要显示；智能回复 3 选项可填入；智能打标建议标签可应用（plan-08 就绪时）；列表行摘要 popover。

- [ ] **Step 6: Commit**

```bash
git add src/app/mails/[id]/page.tsx src/app/mails/page.tsx
git commit -m "feat(ui): AI summarize/smart-reply/auto-tag in mail list + detail"
git push
```

---

## 验收标准

- [ ] **LLM 配置中心（P0）**：`getLlmConfig()` 优先读 settings 表、env 作 fallback；`getLlmClient(capability?)`/`getModelName(capability?)` 按能力取模型（能力覆盖 > 顶层 > defaults），客户端按 `provider|baseUrl` 单例缓存（改配置即重建）。多 provider 支持 deepseek/qwen/**zhipu**。
- [ ] `/api/llm/config` GET（apiKey 脱敏 + providers 列表）/ PATCH（upsert，空 apiKey 不清空）可用；`/api/llm/test` 连接测试返回 ok/latencyMs/error（区分 401/404/网络）。
- [ ] 设置页 LLM tab **可编辑**（不再 env 只读）：provider 下拉、apiKey（masked + 可见切换）、baseUrl、model、温度、各能力模型覆盖、测试连通、保存。
- [ ] **AI 邮件摘要**：`buildSummarizePrompt` 纯函数（brief/bullet/normal 风格、中文、不编造、可测）；`/api/summarize` 按 messageId 取正文、截断、用 `summarize` 能力模型、404/400 边界。
- [ ] **智能回复建议**：`buildSuggestReplyPrompt` + `parseSuggestReplyResult`（严格 JSON 数组、容错解析、非法返回空数组）；`/api/suggest-reply` 用 `reply` 能力模型。
- [ ] **智能分类打标**：`buildAutoTagPrompt`（复用既有标签优先）+ `parseAutoTagResult`（labels/priority/importance/reason，字段缺失给默认）；`/api/auto-tag` 用 `classify` 能力模型、**只产建议不写 message_labels**（写入依赖 plan-08）。
- [ ] **能力可插拔**：摘要/润色/分类各自可配不同底层模型，设置页生效（`getModelName('summarize'|'polish'|'classify')` 命中能力覆盖）。
- [ ] **向后兼容**：现有 `/api/reply`、`/api/polish`、`/api/extract`、`src/lib/extractor` 在 DB-first 重构后行为不变（无 capability 实参走顶层模型），相关测试全绿。
- [ ] `npm test` 全绿（llm/config/client、prompts/{summarize,suggest-reply,auto-tag}、api/{llm-config,llm-test,summarize,suggest-reply,auto-tag}）。
- [ ] `npx tsc --noEmit` 无类型错误。
- [ ] （P2 预留）Newsletter 识别 + 一键退订——本计划不实现，仅文档标注预留接口（`/api/summarize` 可扩 `style:'newsletter'` + 退订链接抽取复用 plan-11 `extractLinks`）。

## 依赖

- **子项目 1**：drizzle 迁移框架 + `settings` key-value 表（已存在，本计划不新增表，只用 settings key）。
- **子项目 2**：无强依赖（provider preset 思路复用，但 LLM 不经 MailAdapter）。
- **子项目 8（打标）**：智能分类打标依赖 `labels`/`message_labels` 表与标签写入接口；本计划 `/api/auto-tag` 只产建议，标签应用（写入）调 plan-08 的打标接口。若 plan-08 未就绪，auto-tag 建议只读展示。
- 现有 `src/lib/llm/{client,providers,polish}.ts`、`src/lib/extractor/`、`src/app/api/{reply,polish,extract}/route.ts`（重构复用）。

## 风险

- **API key 明文存 DB**：本地硬约束接受，卫生同 auth_code（db 不入 git、不入未加密云同步）。**缓解**：GET 接口脱敏（`apiKeyMasked` + `apiKeySet`，不回传明文）；前端 password 输入；README/AGENTS 注明卫生点。
- **向后兼容回归**：`getLlmClient`/`getModelName` 签名变化可能破坏现有调用。**缓解**：capability/db 参数全可选，无实参即旧行为；Task 1 Step 6 + Task 7 跑全量回归（polish/extractor 测试 + tsc）。
- **单例缓存 stale**：改了配置但缓存未清 → 仍用旧客户端/key。**缓解**：`PATCH /api/llm/config` 后调 `__resetLlmClientCache()`；缓存键含 `baseUrl`（改 provider/baseUrl 自动重建）。
- **连接测试真实联网**：`/api/llm/test` 真发一次最小补全，慢/收费。**缓解**：`max_tokens:1`、`content:'ping'`、超时控制（OpenAI SDK 默认 timeout）；失败不抛 5xx，返回 `{ok:false,error}` 给前端友好提示。
- **LLM 输出格式不稳定（JSON 不合规）**：智能回复/打标要求严格 JSON，模型可能返回围栏或散文。**缓解**：system prompt 强约束 + `parseSuggestReplyResult`/`parseAutoTagResult` 容错解析（剥围栏、正则抽 `[...]`/`{...}`、失败返回安全默认空结构，不抛错、不崩路由）。
- **标签依赖 plan-08**：若 plan-08 未就绪，auto-tag 建议无法落库。**缓解**：`/api/auto-tag` 查 labels 表用 try/catch（表不存在则 `availableLabels=[]`，仍能建议新标签名）；UI 应用按钮在 plan-08 未就绪时禁用并 tooltip 说明；建议展示本身不依赖 plan-08。
- **provider baseURL/model 拼错**：用户填错 baseUrl 导致连接失败但报错含糊。**缓解**：测试端点区分 401（key 错）/404（端点或模型名错）/网络错，给出可读中文提示；provider 下拉切换自动填经验证过的 defaults。
