# ActBox Phase 0+1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Next.js 项目地基 + 实现邮件待办抽取引擎（粘贴邮件文本 → LLM 抽取 → 页面显示待办列表）

**Architecture:** Next.js App Router 全栈应用。抽取引擎在后端通过 OpenAI 兼容 SDK 调用国产 LLM（DeepSeek/通义千问），中文特化 prompt 识别待办。前端用 Tailwind + shadcn/ui，一个文本框粘贴邮件、一个按钮触发抽取、下方列表显示结果。纯内存运行（Phase 2 才接数据库）。

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS, shadcn/ui, OpenAI SDK (兼容国产 LLM), Vitest

**Plan scope:** Phase 0（地基）+ Phase 1（抽取引擎）。Phase 2-5 另行计划。

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (Phase 0)
│   ├── page.tsx                # 主页 - 粘贴邮件 + 待办列表 (Phase 1)
│   ├── globals.css             # Tailwind globals (Phase 0)
│   └── api/
│       └── extract/
│           └── route.ts        # POST /api/extract - 调 LLM 抽取待办 (Phase 1)
├── components/
│   ├── ui/                     # shadcn/ui 组件 (Phase 0)
│   ├── EmailInput.tsx          # 邮件粘贴区 (Phase 1)
│   └── TodoList.tsx            # 待办列表展示 (Phase 1)
├── lib/
│   ├── llm/
│   │   ├── client.ts           # OpenAI 兼容客户端封装 (Phase 1)
│   │   └── providers.ts        # Provider 配置映射 (Phase 1)
│   └── extractor/
│       ├── types.ts            # 类型定义: RawMessage, ExtractedTodo, ExtractResult (Phase 1)
│       ├── prompt.ts           # 中文特化抽取 prompt (Phase 1)
│       └── index.ts            # extractTodos() 主函数 (Phase 1)
├── __tests__/
│   └── extractor/
│       ├── golden.test.ts      # 金标准测试: 典型中文邮件 (Phase 1)
│       └── prompt.test.ts      # Prompt 格式/结构验证 (Phase 1)
├── .env.local                  # 本地环境变量 (Phase 0, gitignored)
├── .env.example                # 环境变量模板 (Phase 0)
└── ... (next.js 配置文件)
```

---

## Phase 0: 地基 — 项目初始化

### Task 0.1: 创建 Next.js 项目

**Files:**
- Create: 项目配置文件 (next.config.ts, tsconfig.json, package.json, etc.)
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `.env.example`

- [ ] **Step 1: 运行 create-next-app**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-git --import-alias "@/*"
```

> 已有 .git 目录和 docs/ 目录，用 `--no-git` 保留现有 git 历史。如果目录非空导致失败，先 `cd /tmp && npx create-next-app@latest actbox-temp ...`，然后 `rsync` 过来。

- [ ] **Step 2: 验证项目运行**

Run: `npm run dev`
Expected: 浏览器打开 `http://localhost:3000` 看到默认 Next.js 页面

- [ ] **Step 3: 创建 .env.example**

```env
# LLM Provider (deepseek | qwen)
LLM_PROVIDER=deepseek

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# 通义千问
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

# 邮箱配置 (Phase 3+ 使用)
# IMAP_HOST=imap.qq.com
# IMAP_PORT=993
# IMAP_USER=your@qq.com
# IMAP_AUTH_CODE=
# SMTP_HOST=smtp.qq.com
# SMTP_PORT=465
```

- [ ] **Step 4: 创建 .env.local（从 example 复制）**

```bash
cp .env.example .env.local
```

确认 `.gitignore` 包含 `.env.local`（create-next-app 默认已包含）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore: initialize Next.js project with TypeScript + Tailwind"
```

---

### Task 0.2: 安装核心依赖 + shadcn/ui

**Files:**
- Modify: `package.json`
- Create: `src/components/ui/` (shadcn 组件)
- Create: `components.json` (shadcn 配置)

- [ ] **Step 1: 安装运行时依赖**

```bash
npm install openai
```

> 只安装 Phase 0+1 需要的依赖。Phase 2+ 的 drizzle-orm、imapflow、nodemailer、node-cron 等在各自阶段安装（YAGNI）。

- [ ] **Step 2: 安装测试依赖**

```bash
npm install -D vitest @vitejs/plugin-react
```

> 不用 Jest — Vitest 更快、ESM 友好、与 Vite 生态一致。

- [ ] **Step 3: 初始化 shadcn/ui**

```bash
npx shadcn@latest init -d
```

`-d` 使用默认配置（New York style, Zinc color, CSS variables）。

- [ ] **Step 4: 安装需要的 shadcn 组件**

```bash
npx shadcn@latest add button card textarea
```

Phase 1 需要用到 Button、Card、Textarea 三个组件。

- [ ] **Step 5: 配置 Vitest**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

Add script to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: 验证测试框架**

Run: `npm test`
Expected: 无测试文件时输出 "no test files found"，不报错

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: add openai, vitest, shadcn/ui dependencies"
```

---

## Phase 1: 抽取引擎 — 邮件文本 → 待办列表

### Task 1.1: 定义核心类型

**Files:**
- Create: `src/lib/extractor/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// src/lib/extractor/types.ts

/** 邮件原文（适配器层产出，Phase 3 会完整定义） */
export interface RawMessage {
  source: 'email' | 'lark' | 'dingtalk' // 预留多源
  messageId: string
  subject: string
  from: string
  body: string       // 清洗后的纯文本正文
  receivedAt: Date
}

/** LLM 抽取出的单条待办 */
export interface ExtractedTodo {
  title: string       // 待办事项标题
  dueDate?: string    // 截止日期（自然语言原文，如"下周五前"）
  priority?: 'high' | 'medium' | 'low'
  context?: string    // 原文中的关键上下文片段
}

/** 抽取引擎的完整输出 */
export interface ExtractResult {
  todos: ExtractedTodo[]
  sourceMessageId?: string  // 来源邮件 ID（Phase 2 用）
  rawInput: string          // 保留原文，方便调试
}

/** LLM 返回的 JSON 结构（用于类型校验） */
export interface LlmExtractionResponse {
  todos: Array<{
    title: string
    dueDate?: string
    priority?: 'high' | 'medium' | 'low'
    context?: string
    isActionable: boolean  // LLM 判断是否需要行动
  }>
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/extractor/types.ts
git commit -m "feat: define core types for extraction engine"
```

---

### Task 1.2: 实现 LLM 客户端封装（多 Provider）

**Files:**
- Create: `src/lib/llm/providers.ts`
- Create: `src/lib/llm/client.ts`

- [ ] **Step 1: 创建 Provider 配置映射**

```typescript
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
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
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
```

- [ ] **Step 2: 创建 LLM 客户端**

```typescript
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
    throw new Error(`Unknown LLM provider: ${provider}. Supported: ${Object.keys(PROVIDERS).join(', ')}`)
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
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/llm/
git commit -m "feat: add LLM client with multi-provider support (DeepSeek, Qwen)"
```

---

### Task 1.3: 编写中文特化抽取 Prompt

**Files:**
- Create: `src/lib/extractor/prompt.ts`
- Create: `src/__tests__/extractor/prompt.test.ts`

- [ ] **Step 1: 写 Prompt 格式验证测试**

```typescript
// src/__tests__/extractor/prompt.test.ts

import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/extractor/prompt'

describe('buildExtractionPrompt', () => {
  it('should include the email body', () => {
    const result = buildExtractionPrompt('这是一封测试邮件')
    expect(result).toContain('这是一封测试邮件')
  })

  it('should request JSON output format', () => {
    const result = buildExtractionPrompt('测试')
    expect(result).toContain('"todos"')
    expect(result).toContain('"title"')
    expect(result).toContain('"isActionable"')
  })

  it('should include Chinese-specific instructions', () => {
    const result = buildExtractionPrompt('测试')
    expect(result).toContain('截止')
    expect(result).toContain('委婉')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test -- src/__tests__/extractor/prompt.test.ts`
Expected: FAIL — `buildExtractionPrompt` 不存在

- [ ] **Step 3: 实现抽取 Prompt**

```typescript
// src/lib/extractor/prompt.ts

const SYSTEM_PROMPT = `你是一个专业的邮件待办提取助手。你的任务是分析邮件内容，识别出需要收件人采取行动的事项。

## 核心规则

1. **只提取需要行动的事项** — 纯通知、确认收到、信息分享不算待办
   - ❌ "已收到，谢谢" → 不是待办
   - ❌ "FYI，项目文档在共享文件夹" → 不是待办
   - ✅ "麻烦帮看下这个方案" → 是待办
   - ✅ "辛苦跟进一下客户反馈" → 是待办

2. **识别中文截止表达**
   - "下周五前" "月底之前" "节前" "尽快" "本周内" "明天"
   - 将这些原样保留到 dueDate 字段

3. **识别委婉请求** — 中文常见委婉表达实际是待办
   - "麻烦..." "辛苦..." "帮忙..." "看一下" "跟进一下"
   - "能不能..." "方便的话..." "希望可以..."

4. **多个待办分别成条，不合并**

5. **判断优先级**
   - high: 紧急、领导/客户要求、有明确短期截止日
   - medium: 有截止日但不紧急
   - low: 无明确截止日、一般性请求

## 输出格式

返回严格的 JSON，不要多余文字：
{
  "todos": [
    {
      "title": "待办事项简述",
      "dueDate": "截止日期原文或null",
      "priority": "high/medium/low",
      "context": "邮件中与该待办相关的关键原文片段",
      "isActionable": true
    }
  ]
}

如果没有可提取的待办：
{
  "todos": []
}`

/**
 * 构建抽取 prompt
 */
export function buildExtractionPrompt(emailBody: string): string {
  return `${SYSTEM_PROMPT}\n\n## 待分析邮件内容\n\n${emailBody}`
}

/** 获取 system prompt（用于 API messages 格式） */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test -- src/__tests__/extractor/prompt.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/extractor/prompt.ts src/__tests__/extractor/prompt.test.ts
git commit -m "feat: add Chinese-specialized extraction prompt with tests"
```

---

### Task 1.4: 实现抽取引擎核心函数

**Files:**
- Create: `src/lib/extractor/index.ts`

- [ ] **Step 1: 实现主抽取函数**

```typescript
// src/lib/extractor/index.ts

import { getLlmClient, getModelName } from '@/lib/llm/client'
import { getSystemPrompt } from './prompt'
import type { ExtractResult, ExtractedTodo, LlmExtractionResponse } from './types'

/**
 * 从邮件正文中抽取待办事项
 * @param emailBody 邮件清洗后的纯文本正文
 * @returns 抽取结果
 */
export async function extractTodos(emailBody: string): Promise<ExtractResult> {
  const client = getLlmClient()
  const model = getModelName()

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: emailBody },
    ],
    temperature: 0.1, // 低温度，稳定输出
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('LLM returned empty response')
  }

  // 解析 JSON（容错处理）
  let parsed: LlmExtractionResponse
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\nRaw: ${content}`)
  }

  // 只保留可行动的待办
  const todos: ExtractedTodo[] = (parsed.todos || [])
    .filter((t) => t.isActionable !== false)
    .map((t) => ({
      title: t.title,
      dueDate: t.dueDate || undefined,
      priority: t.priority || undefined,
      context: t.context || undefined,
    }))

  return {
    todos,
    rawInput: emailBody,
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/extractor/index.ts
git commit -m "feat: implement extractTodos() with LLM call and JSON parsing"
```

---

### Task 1.5: 编写金标准测试

**Files:**
- Create: `src/__tests__/extractor/golden.test.ts`
- Create: `src/__tests__/extractor/fixtures.ts`

- [ ] **Step 1: 创建测试邮件 fixture**

```typescript
// src/__tests__/extractor/fixtures.ts

/** 典型中文邮件测试集 */
export const GOLDEN_EMAILS = [
  {
    name: '领导分派任务 + 明确截止日',
    input: `王总：

请安排一下Q3的报表整理工作，下周五前交给我。
另外客户那边有个合同需要回复，时间比较紧，这周五之前搞定。

谢谢
李总`,
    expectTodos: 2,
    expectKeywords: ['Q3', '报表', '合同'],
  },
  {
    name: '委婉请求',
    input: `嗨，小明，

辛苦帮忙看一下昨天那个bug，测试那边报了两次了。
不着急，有空处理就行。

小红`,
    expectTodos: 1,
    expectKeywords: ['bug'],
  },
  {
    name: '纯通知 - 不应产生待办',
    input: `各位同事：

已收到大家的周报，汇总后发给领导了。
谢谢大家的配合！

行政部`,
    expectTodos: 0,
    expectKeywords: [],
  },
  {
    name: '多待办混合',
    input: `张经理：

关于新项目启动，有几点需要处理：
1. 尽快确认技术方案，最好这周内
2. 麻烦安排下团队kick-off meeting
3. 预算审批已经走完了，通知一下大家就行

另外上次的报销麻烦帮我催一下财务。

谢谢
刘总`,
    expectTodos: 3,  // 1,2,4 是待办；3 是"通知一下"也可能是待办
    expectKeywords: ['技术方案', 'meeting', '报销'],
  },
  {
    name: '模糊截止表达',
    input: `王工：

项目进度有点滞后，节前需要完成第一阶段。
客户说月底前要看到演示版本。

老板`,
    expectTodos: 2,
    expectKeywords: ['节前', '月底'],
  },
]
```

- [ ] **Step 2: 写金标准测试**

```typescript
// src/__tests__/extractor/golden.test.ts

import { describe, it, expect } from 'vitest'
import { extractTodos } from '@/lib/extractor'
import { GOLDEN_EMAILS } from './fixtures'

/**
 * 金标准测试 — 需要真实 LLM API 调用
 * 运行前确保 .env.local 配置了有效的 LLM_API_KEY
 *
 * 运行方式: npm run test:golden
 * 普通测试不会执行这些（用 describe.skip 机制或环境变量控制）
 */
describe.skip('Golden Tests - LLM Extraction (requires API key)', () => {
  // 只在明确请求时运行
  const shouldRun = process.env.RUN_GOLDEN_TESTS === 'true'

  beforeAll(() => {
    if (!shouldRun) return
    if (!process.env.DEEPSEEK_API_KEY && !process.env.QWEN_API_KEY) {
      throw new Error('Set DEEPSEEK_API_KEY or QWEN_API_KEY in .env.local to run golden tests')
    }
  })

  GOLDEN_EMAILS.forEach(({ name, input, expectTodos, expectKeywords }) => {
    it(name, async () => {
      if (!shouldRun) return

      const result = await extractTodos(input)

      // 待办数量允许 ±1 的误差（LLM 输出不完全确定性）
      expect(result.todos.length).toBeGreaterThanOrEqual(Math.max(0, expectTodos - 1))
      expect(result.todos.length).toBeLessThanOrEqual(expectTodos + 1)

      // 关键词检查：至少一半的待办应该包含期望关键词
      if (expectKeywords.length > 0) {
        const titles = result.todos.map((t) => t.title).join(' ')
        const contexts = result.todos.map((t) => t.context || '').join(' ')
        const allText = titles + ' ' + contexts
        const matchedKeywords = expectKeywords.filter((kw) => allText.includes(kw))
        expect(matchedKeywords.length).toBeGreaterThanOrEqual(Math.ceil(expectKeywords.length / 2))
      }

      // 结果结构验证
      result.todos.forEach((todo) => {
        expect(todo.title).toBeTruthy()
        expect(todo.title.length).toBeGreaterThan(2)
      })
    }, 30_000) // LLM 调用需要较长超时
  })
})
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test:golden": "RUN_GOLDEN_TESTS=true vitest run src/__tests__/extractor/golden.test.ts --testNamePattern='Golden'"
  }
}
```

- [ ] **Step 3: 验证测试框架不报错**

Run: `npm test`
Expected: prompt.test.ts 通过，golden.test.ts 被 skip（未设 RUN_GOLDEN_TESTS）

- [ ] **Step 4: 提交**

```bash
git add src/__tests__/extractor/
git commit -m "test: add golden test fixtures and extraction validation tests"
```

---

### Task 1.6: 创建 API 路由 — POST /api/extract

**Files:**
- Create: `src/app/api/extract/route.ts`

- [ ] **Step 1: 实现 API 路由**

```typescript
// src/app/api/extract/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { extractTodos } from '@/lib/extractor'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { emailBody } = body

    if (!emailBody || typeof emailBody !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid emailBody field' },
        { status: 400 }
      )
    }

    if (emailBody.length > 50_000) {
      return NextResponse.json(
        { error: 'Email body too long (max 50,000 characters)' },
        { status: 400 }
      )
    }

    const result = await extractTodos(emailBody)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/extract] Error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'

    // 区分配置错误和服务错误
    if (message.includes('API key') || message.includes('provider')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: 手动测试 API**

Run: `npm run dev`（另一个终端）

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{"emailBody": "麻烦帮我看下这个方案，下周五前给反馈。"}'
```

Expected: JSON 响应包含 `todos` 数组，至少一条待办

- [ ] **Step 3: 提交**

```bash
git add src/app/api/extract/route.ts
git commit -m "feat: add POST /api/extract route for todo extraction"
```

---

### Task 1.7: 创建前端页面

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/EmailInput.tsx`
- Create: `src/components/TodoList.tsx`

- [ ] **Step 1: 创建 EmailInput 组件**

```typescript
// src/components/EmailInput.tsx

'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface EmailInputProps {
  onSubmit: (text: string) => void
  isLoading: boolean
}

export function EmailInput({ onSubmit, isLoading }: EmailInputProps) {
  const [text, setText] = useState('')

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim())
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>📬 粘贴邮件内容</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="将邮件正文粘贴到这里..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono text-sm"
        />
        <Button
          onClick={handleSubmit}
          disabled={!text.trim() || isLoading}
          className="w-full"
        >
          {isLoading ? '🔍 正在分析...' : '🔍 提取待办'}
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: 创建 TodoList 组件**

```typescript
// src/components/TodoList.tsx

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ExtractedTodo } from '@/lib/extractor/types'

interface TodoListProps {
  todos: ExtractedTodo[]
}

const priorityBadge: Record<string, { label: string; color: string }> = {
  high: { label: '🔴 紧急', color: 'text-red-600' },
  medium: { label: '🟡 一般', color: 'text-yellow-600' },
  low: { label: '🟢 不急', color: 'text-green-600' },
}

export function TodoList({ todos }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          ✅ 这封邮件里没有需要你做的事
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>📋 发现 {todos.length} 条待办</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {todos.map((todo, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border p-3"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {i + 1}
            </span>
            <div className="flex-1 space-y-1">
              <p className="font-medium">{todo.title}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {todo.dueDate && (
                  <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-700">
                    📅 {todo.dueDate}
                  </span>
                )}
                {todo.priority && (
                  <span className={priorityBadge[todo.priority]?.color || ''}>
                    {priorityBadge[todo.priority]?.label || todo.priority}
                  </span>
                )}
              </div>
              {todo.context && (
                <p className="text-xs text-muted-foreground italic">
                  "{todo.context}"
                </p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: 更新主页**

```typescript
// src/app/page.tsx

'use client'

import { useState } from 'react'
import { EmailInput } from '@/components/EmailInput'
import { TodoList } from '@/components/TodoList'
import type { ExtractedTodo, ExtractResult } from '@/lib/extractor/types'

export default function Home() {
  const [todos, setTodos] = useState<ExtractedTodo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExtract = async (emailBody: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      const result = data as ExtractResult
      setTodos(result.todos)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
      setTodos([])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-20">
      <div className="text-center">
        <h1 className="text-2xl font-bold">📬 ActBox</h1>
        <p className="text-sm text-muted-foreground">
          粘贴邮件，自动提取待办事项
        </p>
      </div>

      <EmailInput onSubmit={handleExtract} isLoading={isLoading} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {todos.length > 0 && <TodoList todos={todos} />}
    </main>
  )
}
```

- [ ] **Step 4: 更新 layout.tsx 标题**

在 `src/app/layout.tsx` 中将 `<title>` 改为 `ActBox - 邮件待办提取`。

- [ ] **Step 5: 浏览器验证**

Run: `npm run dev`
1. 打开 `http://localhost:3000`
2. 在文本框粘贴测试邮件："麻烦帮我看下这个方案，下周五前给反馈。谢谢"
3. 点击「提取待办」
4. Expected: 看到提取出的待办列表，包含标题、截止日期、优先级

- [ ] **Step 6: 提交**

```bash
git add src/app/page.tsx src/components/ src/app/layout.tsx
git commit -m "feat: add email input + todo list UI for extraction engine"
```

---

### Task 1.8: 端到端验收

**Files:** 无新文件

- [ ] **Step 1: 完整流程测试**

Run: `npm run dev`

用以下邮件逐一测试：

**测试 A - 有待办：**
```
王总：

请安排一下Q3的报表整理工作，下周五前交给我。
另外客户那边有个合同需要回复，这周五之前搞定。

谢谢
李总
```
Expected: 提取 2 条待办，分别有截止日期

**测试 B - 无待办（纯通知）：**
```
各位同事：

已收到大家的周报，汇总后发给领导了。
谢谢大家的配合！

行政部
```
Expected: 显示 "这封邮件里没有需要你做的事"

**测试 C - LLM 未配置：**
临时删除 `.env.local` 中的 API Key，重启 dev server，再次提取。
Expected: 页面显示错误提示，包含 "API key" 相关信息，不崩溃

- [ ] **Step 2: 运行所有自动化测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: Phase 1 complete - email extraction engine with Chinese-specialized prompt"
```

---

## Verification

Phase 0+1 完成后，以下能力应可用：

| 验证项 | 方法 | 预期 |
|--------|------|------|
| 项目启动 | `npm run dev` | localhost:3000 可访问 |
| UI 渲染 | 浏览器打开 | 看到文本框和提取按钮 |
| 中文待办抽取 | 粘贴含待办的中文邮件 | 列出提取的待办 |
| 纯通知过滤 | 粘贴纯通知邮件 | 显示"无待办" |
| 错误处理 | 无 API Key 时提取 | 页面显示错误提示，不崩溃 |
| Provider 切换 | `.env.local` 改 `LLM_PROVIDER=qwen` | 正常调用通义千问 |
| 测试通过 | `npm test` | 全绿 |
| Git 历史 | `git log --oneline` | 约 7-8 个清晰 commit |

---

## Phase 2-5 Preview

后续阶段概要（详细计划在各自阶段开始前编写）：

| Phase | 核心工作 | 关键新依赖 |
|-------|---------|-----------|
| 2 存起来 | SQLite + Drizzle, 待办 CRUD, 持久化列表页 | drizzle-orm, better-sqlite3 |
| 3 接邮箱 | IMAP 收件, HTML 清洗, 幂等去重 | imapflow |
| 4 自动化 | node-cron 定时拉取, 截止提醒, 配置页 | node-cron |
| 5 回邮件 | SMTP 发件, AI 起草, 人工确认发送 | nodemailer |
