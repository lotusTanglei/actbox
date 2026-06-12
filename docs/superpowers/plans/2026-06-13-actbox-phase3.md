# ActBox Phase 3 Implementation Plan — 接邮箱 IMAP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 IMAP 收件，连接网易 163 邮箱拉取未读邮件 → 清洗正文 → 调抽取引擎 → 保存待办到 DB → 页面「📥拉取」按钮触发。幂等去重（已处理邮件不再重复抽取）。

**Architecture:** `imapflow` 连 IMAP 拉未读邮件，清洗 HTML 正文为纯文本，对每封邮件先查 `messages` 表去重，未处理过的走抽取引擎 + 存 DB。前端加「📥拉取」按钮调用 `/api/fetch`。

**Tech Stack:** 新增 imapflow, node-html-to-text

**Plan scope:** Phase 3（接邮箱）。Phase 4-5 另行计划。

---

## Context

Phase 2 完成了持久化存储（SQLite + Drizzle），待办可以 CRUD。但目前还是手动粘贴邮件文本。Phase 3 让 ActBox 能自动从真实邮箱拉取邮件，自动识别待办并入库。这是产品从"玩具"到"工具"的关键一步。

**邮箱配置：**
- Provider: 网易 163
- IMAP: imap.163.com:993 (TLS)
- User: tanglei_12301@163.com
- Auth Code: RY5WRMiwM5VbDD8q

---

## File Structure

```
src/
├── lib/
│   ├── adapter/
│   │   ├── types.ts            # SourceAdapter 接口 + RawMessage（从 extractor/types 移入）
│   │   └── mail/
│   │       ├── receiver.ts     # MailReceiver: IMAP 收件
│   │       ├── cleaner.ts      # 邮件正文清洗（HTML → 纯文本）
│   │       └── index.ts        # MailAdapter 实现
│   └── extractor/
│       └── types.ts            # 保留 ExtractedTodo 等，RawMessage 引用改为从 adapter
├── app/
│   ├── api/
│   │   └── fetch/
│   │       └── route.ts        # POST /api/fetch — 手动拉取邮箱
│   └── page.tsx                # 加 📥拉取 按钮
└── __tests__/
    └── adapter/
        └── cleaner.test.ts     # 邮件清洗测试
```

---

## Task 3.1: 安装 imapflow + html-to-text

**Files:** Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
npm install imapflow node-html-to-text
```

- [ ] **Step 2: 更新 .env.local 和 .env.example**

追加到 `.env.local`:

```env
IMAP_HOST=imap.163.com
IMAP_PORT=993
IMAP_USER=tanglei_12301@163.com
IMAP_AUTH_CODE=RY5WRMiwM5VbDD8q
```

追加到 `.env.example`（值留空）:

```env
IMAP_HOST=imap.163.com
IMAP_PORT=993
IMAP_USER=
IMAP_AUTH_CODE=
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: add imapflow, node-html-to-text dependencies"
```

---

## Task 3.2: 创建 SourceAdapter 接口 + 邮件清洗

**Files:**
- Create: `src/lib/adapter/types.ts`
- Create: `src/lib/adapter/mail/cleaner.ts`
- Create: `src/__tests__/adapter/cleaner.test.ts`

- [ ] **Step 1: 定义 SourceAdapter 接口**

```typescript
// src/lib/adapter/types.ts

/** 统一消息格式（所有消息源适配器的输出） */
export interface RawMessage {
  source: 'email' | 'lark' | 'dingtalk'
  messageId: string
  subject: string
  from: string
  body: string       // 清洗后的纯文本正文
  receivedAt: Date
}

/** 消息源适配器接口（可插拔） */
export interface SourceAdapter {
  /** 拉取新消息 */
  fetchNew(): Promise<RawMessage[]>
}
```

- [ ] **Step 2: 实现邮件正文清洗**

```typescript
// src/lib/adapter/mail/cleaner.ts

import { convert } from 'node-html-to-text'

/**
 * 清洗邮件正文：HTML → 纯文本，去引用/签名
 */
export function cleanEmailBody(
  html: string | undefined,
  text: string | undefined
): string {
  // 优先用纯文本（如果有的话）
  if (text && text.trim().length > 20) {
    return removeQuotedText(text.trim())
  }

  // HTML 转纯文本
  if (html) {
    const plain = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'script', format: 'skip' },
      ],
    })
    return removeQuotedText(plain.trim())
  }

  return ''
}

/**
 * 去除邮件引用/转发部分
 */
function removeQuotedText(text: string): string {
  // 常见引用分隔符
  const patterns = [
    /-{2,}\s*原始邮件\s*-{2,}/i,
    /On .+ wrote:/i,
    /\d{4}年\d{1,2}月\d{1,2}日.+写道：/,
    /发件人[:：]/,
    /From[:：]/,
    /\n>\s*.+/,  // 引用行
  ]

  let cleaned = text
  for (const pattern of patterns) {
    const match = cleaned.search(pattern)
    if (match > 50) {
      // 只在较后面的位置才截断（避免误删正文）
      cleaned = cleaned.substring(0, match).trim()
    }
  }

  return cleaned
}
```

- [ ] **Step 3: 写清洗测试**

```typescript
// src/__tests__/adapter/cleaner.test.ts

import { describe, it, expect } from 'vitest'
import { cleanEmailBody } from '@/lib/adapter/mail/cleaner'

describe('cleanEmailBody', () => {
  it('should prefer plain text when available', () => {
    const result = cleanEmailBody('<p>Hello</p>', 'Plain text content here that is long enough to use')
    expect(result).toBe('Plain text content here that is long enough to use')
  })

  it('should convert HTML to text', () => {
    const result = cleanEmailBody('<h1>标题</h1><p>内容段落</p>', undefined)
    expect(result).toContain('标题')
    expect(result).toContain('内容段落')
  })

  it('should remove quoted reply', () => {
    const text = '这是我的回复内容\n\n---原始邮件---\n发件人: 张三\n\n原始内容'
    const result = cleanEmailBody(undefined, text)
    expect(result).toContain('这是我的回复内容')
    expect(result).not.toContain('原始内容')
  })

  it('should return empty for no content', () => {
    const result = cleanEmailBody(undefined, undefined)
    expect(result).toBe('')
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: All pass

- [ ] **Step 5: 提交**

```bash
git add src/lib/adapter/ src/__tests__/adapter/
git commit -m "feat: add SourceAdapter interface and email body cleaner"
```

---

## Task 3.3: 实现 MailReceiver（IMAP 收件）

**Files:**
- Create: `src/lib/adapter/mail/receiver.ts`
- Create: `src/lib/adapter/mail/index.ts`

- [ ] **Step 1: 实现 MailReceiver**

```typescript
// src/lib/adapter/mail/receiver.ts

import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { cleanEmailBody } from './cleaner'
import type { RawMessage } from '../types'

interface MailConfig {
  host: string
  port: number
  user: string
  authCode: string
}

export class MailReceiver {
  private config: MailConfig

  constructor(config?: Partial<MailConfig>) {
    this.config = {
      host: config?.host || process.env.IMAP_HOST || 'imap.163.com',
      port: config?.port || parseInt(process.env.IMAP_PORT || '993'),
      user: config?.user || process.env.IMAP_USER || '',
      authCode: config?.authCode || process.env.IMAP_AUTH_CODE || '',
    }
  }

  /**
   * 拉取最近的未读邮件（最多 limit 封）
   */
  async fetchRecent(limit = 10): Promise<RawMessage[]> {
    if (!this.config.user || !this.config.authCode) {
      throw new Error('IMAP 未配置: 请在 .env.local 中设置 IMAP_USER 和 IMAP_AUTH_CODE')
    }

    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: {
        user: this.config.user,
        pass: this.config.authCode,
      },
      logger: false as any,
    })

    const messages: RawMessage[] = []

    try {
      await client.connect()

      const lock = await client.getMailboxLock('INBOX')

      try {
        // 搜索最近的邮件（按日期倒序）
        const searchResult = await client.search({
          seen: false, // 未读
        }, { uid: true })

        if (searchResult.length === 0) {
          return []
        }

        // 取最近的 limit 封
        const toFetch = searchResult.slice(-limit).reverse()

        for await (const msg of client.fetch(toFetch, {
          source: true,
          envelope: true,
          bodyStructure: true,
        })) {
          const raw = this.parseMessage(msg)
          if (raw) messages.push(raw)
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    return messages
  }

  private parseMessage(msg: FetchMessageObject): RawMessage | null {
    const envelope = msg.envelope
    if (!envelope) return null

    const from = envelope.from?.[0]?.address || envelope.from?.[0]?.name || '未知'
    const subject = envelope.subject || '(无主题)'
    const messageId = envelope.messageId || ''

    // 提取正文：优先 text/plain，其次 HTML 转文本
    const source = msg.source
    let textBody: string | undefined
    let htmlBody: string | undefined

    if (typeof source === 'string') {
      // imapflow source 是原始 MIME，简单提取
      // 对于简单邮件，source 可能直接是正文
      if (source.includes('<html') || source.includes('<body')) {
        htmlBody = source
      } else {
        textBody = source
      }
    }

    const body = cleanEmailBody(htmlBody, textBody)

    return {
      source: 'email',
      messageId,
      subject,
      from,
      body,
      receivedAt: envelope.date ? new Date(envelope.date) : new Date(),
    }
  }
}
```

- [ ] **Step 2: 创建 MailAdapter 入口**

```typescript
// src/lib/adapter/mail/index.ts

export { MailReceiver } from './receiver'
export { cleanEmailBody } from './cleaner'
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/adapter/
git commit -m "feat: implement MailReceiver with IMAP fetch via imapflow"
```

---

## Task 3.4: 创建 /api/fetch 路由 + 幂等去重

**Files:**
- Create: `src/app/api/fetch/route.ts`

- [ ] **Step 1: 实现 fetch API**

```typescript
// src/app/api/fetch/route.ts

import { NextResponse } from 'next/server'
import { MailReceiver } from '@/lib/adapter/mail'
import { extractTodos } from '@/lib/extractor'
import { getDb } from '@/lib/db'
import { todos, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST() {
  try {
    const receiver = new MailReceiver()
    const rawMessages = await receiver.fetchRecent(10)

    if (rawMessages.length === 0) {
      return NextResponse.json({
        fetched: 0,
        newTodos: 0,
        message: '没有未读邮件',
      })
    }

    const db = getDb()
    let newTodosCount = 0
    const processedMessages = []

    for (const msg of rawMessages) {
      // 幂等去重：按 messageId 检查是否已处理
      const existing = db
        .select()
        .from(messages)
        .where(eq(messages.messageId, msg.messageId))
        .all()

      if (existing.length > 0) {
        processedMessages.push({
          subject: msg.subject,
          skipped: true,
          reason: '已处理过',
        })
        continue
      }

      // 跳过正文为空的邮件
      if (!msg.body || msg.body.trim().length < 10) {
        processedMessages.push({
          subject: msg.subject,
          skipped: true,
          reason: '正文为空或太短',
        })
        // 仍然记录，避免下次再拉
        db.insert(messages).values({
          messageId: msg.messageId || `no-id-${Date.now()}`,
          subject: msg.subject,
          from: msg.from,
          body: msg.body,
          receivedAt: msg.receivedAt,
        }).run()
        continue
      }

      // 记录已处理邮件
      db.insert(messages).values({
        messageId: msg.messageId || `no-id-${Date.now()}`,
        subject: msg.subject,
        from: msg.from,
        body: msg.body.substring(0, 500), // 只存摘要
        receivedAt: msg.receivedAt,
      }).run()

      // 抽取待办
      const extractResult = await extractTodos(msg.body)

      for (const todo of extractResult.todos) {
        db.insert(todos).values({
          title: todo.title,
          dueDate: todo.dueDate || null,
          priority: todo.priority || null,
          context: todo.context || null,
          sourceMessageId: msg.messageId,
          sourceSubject: msg.subject,
          sourceFrom: msg.from,
        }).returning().all()
        newTodosCount++
      }

      processedMessages.push({
        subject: msg.subject,
        skipped: false,
        todosExtracted: extractResult.todos.length,
      })
    }

    return NextResponse.json({
      fetched: rawMessages.length,
      newTodos: newTodosCount,
      messages: processedMessages,
    })
  } catch (error) {
    console.error('[/api/fetch] Error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'

    if (message.includes('IMAP') || message.includes('ECONNREFUSED') || message.includes('auth')) {
      return NextResponse.json({ error: `邮箱连接失败: ${message}` }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/fetch/
git commit -m "feat: add POST /api/fetch with IMAP pull and message dedup"
```

---

## Task 3.5: 前端加「📥拉取」按钮

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 在页面头部加拉取按钮 + 状态展示**

在 page.tsx 的 header 区域加 fetch 按钮，在 `handleExtract` 旁边加 `handleFetch` 函数：

```typescript
// 在 Home 组件内新增 state 和 handler

const [isFetching, setIsFetching] = useState(false)
const [fetchResult, setFetchResult] = useState<string | null>(null)

const handleFetch = async () => {
  setIsFetching(true)
  setFetchResult(null)
  setError(null)

  try {
    const res = await fetch('/api/fetch', { method: 'POST' })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || `拉取失败 (${res.status})`)
    }

    setFetchResult(
      `📬 拉取 ${data.fetched} 封邮件，新增 ${data.newTodos} 条待办`
    )
    await fetchTodos()
  } catch (err) {
    setError(err instanceof Error ? err.message : '拉取失败')
  } finally {
    setIsFetching(false)
  }
}
```

页面 header 改为：

```tsx
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold">📬 ActBox</h1>
    <p className="text-sm text-muted-foreground">
      粘贴邮件或拉取邮箱，自动提取待办事项
    </p>
  </div>
  <button
    onClick={handleFetch}
    disabled={isFetching}
    className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
  >
    {isFetching ? '⏳ 拉取中...' : '📥 拉取邮箱'}
  </button>
</div>

{fetchResult && (
  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
    {fetchResult}
  </div>
)}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/page.tsx
git commit -m "feat: add 📥 fetch mailbox button to main page"
```

---

## Task 3.6: 真实邮箱端到端测试

- [ ] **Step 1: 启动 dev server，curl 测试 /api/fetch**

Run: `npm run dev`

```bash
curl -s -X POST http://localhost:3000/api/fetch | python3 -m json.tool
```

Expected: 返回拉取结果，包含邮件数和新增待办数

- [ ] **Step 2: 验证去重 — 再次调用应显示已处理**

```bash
curl -s -X POST http://localhost:3000/api/fetch | python3 -m json.tool
```

Expected: `newTodos: 0`，之前处理过的邮件被跳过

- [ ] **Step 3: 浏览器测试**

1. 打开 http://localhost:3000
2. 点「📥 拉取邮箱」
3. 等待结果提示
4. 待办列表自动刷新，显示从邮件提取的待办
5. 刷新页面 — 数据仍在

- [ ] **Step 4: 运行所有测试**

Run: `npm test`
Expected: All pass

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "feat: Phase 3 complete - IMAP email fetch with dedup"
```

---

## Verification

| 验证项 | 方法 | 预期 |
|--------|------|------|
| IMAP 连接 | `curl -X POST /api/fetch` | 成功拉取未读邮件 |
| 邮件清洗 | cleaner 测试 | HTML → 纯文本，去引用 |
| 待办抽取 | 拉取后查 /api/todos | 邮件待办入库 |
| 幂等去重 | 连续两次 fetch | 第二次 newTodos=0 |
| 前端按钮 | 点击📥拉取 | loading → 结果提示 |
| 错误处理 | 配置错误时 fetch | 清晰错误提示 |
| 测试 | `npm test` | 全绿 |
| Build | `npm run build` | 无错误 |
