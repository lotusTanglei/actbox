# ActBox Phase 2 Implementation Plan — 存起来

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 SQLite + Drizzle ORM，待办持久化存储，页面加载从数据库读取，支持勾选完成、筛选、刷新不丢数据。

**Architecture:** SQLite 单文件 `data/actbox.db`，Drizzle ORM 管理 schema 和查询。`/api/extract` 在抽取后同时保存到 DB。页面改为从 `GET /api/todos` 加载数据，而非纯内存 state。CRUD 通过 REST API 完成。

**Tech Stack:** 新增 drizzle-orm, better-sqlite3, @types/better-sqlite3

**Plan scope:** Phase 2（存起来）。Phase 3-5 另行计划。

---

## Context

Phase 1 完成了邮件待办抽取引擎（粘贴 → LLM → 展示），但数据纯内存，刷新即丢。Phase 2 要让待办"存起来"：每次抽取的结果写入 SQLite，页面从数据库加载，勾选完成/筛选都在持久化数据上操作。这为 Phase 3（IMAP 拉取邮件后自动入库）和 Phase 4（定时任务）奠定存储基础。

---

## File Structure（新增/修改）

```
src/
├── lib/
│   ├── db/
│   │   ├── schema.ts          # Drizzle schema: todos, messages, settings
│   │   ├── index.ts            # DB 连接 + 初始化
│   │   └── migrate.ts          # 首次运行自动建表（push）
│   └── extractor/
│       └── index.ts            # (不变，extractTodos 保持纯函数)
├── app/
│   ├── api/
│   │   ├── extract/
│   │   │   └── route.ts        # 修改: 抽取后保存到 DB
│   │   └── todos/
│   │       ├── route.ts        # 新增: GET (列表) + POST (手动创建)
│   │       └── [id]/
│   │           └── route.ts    # 新增: PATCH (更新状态) + DELETE
│   └── page.tsx                # 修改: 从 DB 加载 + 筛选 + 勾选
├── components/
│   ├── TodoList.tsx            # 修改: 加 checkbox、筛选 tab、删除
│   └── EmailInput.tsx          # (不变)
└── __tests__/
    └── db/
        └── schema.test.ts      # 新增: DB 基础操作测试
```

---

## Task 2.1: 安装 Drizzle + SQLite 依赖

**Files:** Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
npm install drizzle-orm better-sqlite3
npm install -D @types/better-sqlite3 drizzle-kit
```

- [ ] **Step 2: 添加 drizzle config 和 scripts**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/actbox.db',
  },
})
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

- [ ] **Step 3: 创建 data/ 目录并 gitignore db 文件**

```bash
mkdir -p data
```

Add to `.gitignore`:

```
# SQLite database
/data/*.db
/data/*.db-journal
```

Add empty `.gitkeep` to preserve directory:

```bash
touch data/.gitkeep
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: add drizzle-orm, better-sqlite3, drizzle-kit"
```

---

## Task 2.2: 定义 Drizzle Schema

**Files:** Create: `src/lib/db/schema.ts`

- [ ] **Step 1: 创建 schema**

```typescript
// src/lib/db/schema.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/** 待办表 */
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  dueDate: text('due_date'),
  priority: text('priority', { enum: ['high', 'medium', 'low'] }),
  context: text('context'),
  status: text('status', { enum: ['pending', 'done'] }).notNull().default('pending'),
  // 来源邮件信息
  sourceMessageId: text('source_message_id'),
  sourceSubject: text('source_subject'),
  sourceFrom: text('source_from'),
  // 时间戳
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

/** 已处理邮件记录（幂等去重用） */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject'),
  from: text('from'),
  body: text('body'),
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  processedAt: integer('processed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  direction: text('direction', { enum: ['in', 'out'] }).notNull().default('in'),
})

/** 运行配置（Phase 4 用） */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: define Drizzle schema for todos, messages, settings"
```

---

## Task 2.3: 创建 DB 连接模块

**Files:** Create: `src/lib/db/index.ts`

- [ ] **Step 1: 实现 DB 连接（单例 + 自动建表）**

```typescript
// src/lib/db/index.ts

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

let _db: ReturnType<typeof drizzle> | null = null

/** 获取 Drizzle 实例（单例） */
export function getDb() {
  if (_db) return _db

  // 确保 data 目录存在
  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'actbox.db')
  const sqlite = new Database(dbPath)

  // 启用 WAL 模式提升并发性能
  sqlite.pragma('journal_mode = WAL')

  _db = drizzle(sqlite, { schema })

  // 自动建表（开发阶段用 push，不用 migration 文件）
  autoCreateTables(sqlite)

  return _db
}

/** 自动建表（首次运行） */
function autoCreateTables(sqlite: Database.Database) {
  // 简单检查：如果 todos 表存在就跳过
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
    .get()

  if (!tableExists) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due_date TEXT,
        priority TEXT CHECK(priority IN ('high', 'medium', 'low')),
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
        source_message_id TEXT,
        source_subject TEXT,
        source_from TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        subject TEXT,
        sender TEXT,
        body TEXT,
        received_at INTEGER,
        processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        direction TEXT NOT NULL DEFAULT 'in' CHECK(direction IN ('in', 'out'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
    `)
  }
}

/** 重置 DB 实例（测试用） */
export function resetDb() {
  _db = null
}
```

> 注意：`from` 是 SQL 保留字，DDL 中用 `sender`，但 schema.ts 的列名仍用 `from`（Drizzle 会映射）。实际上 Drizzle 默认用列名做字段名，需要用 `sender` 避免冲突。

- [ ] **Step 2: 修正 schema 中 `from` 列名冲突**

在 `src/lib/db/schema.ts` 中，`messages` 表的 `from` 字段改为：

```typescript
from: text('sender'),
```

这样 Drizzle 代码中用 `from` 属性名，但 SQL 列名是 `sender`，避免 SQL 保留字冲突。

- [ ] **Step 3: 提交**

```bash
git add src/lib/db/
git commit -m "feat: add DB connection with auto-create tables and WAL mode"
```

---

## Task 2.4: 创建 Todo CRUD API

**Files:**
- Create: `src/app/api/todos/route.ts`
- Create: `src/app/api/todos/[id]/route.ts`

- [ ] **Step 1: 实现 GET + POST /api/todos**

```typescript
// src/app/api/todos/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { todos } from '@/lib/db/schema'
import { eq, desc, and, like } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

/** GET /api/todos — 列表，支持筛选 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // pending | done | all (default: all)
    const filter = searchParams.get('filter') // today | week | overdue

    let query = db.select().from(todos).orderBy(desc(todos.createdAt))

    const conditions = []
    if (status && status !== 'all') {
      conditions.push(eq(todos.status, status))
    }

    // TODO: filter by date (today/week/overdue) when we add date parsing in Phase 4

    if (conditions.length > 0) {
      query = db.select().from(todos).where(and(...conditions)).orderBy(desc(todos.createdAt))
    }

    const result = query.all()
    return NextResponse.json({ todos: result })
  } catch (error) {
    console.error('[/api/todos GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch todos' },
      { status: 500 }
    )
  }
}

/** POST /api/todos — 手动创建待办 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb()
    const body = await request.json()
    const { title, dueDate, priority, context } = body

    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid title' },
        { status: 400 }
      )
    }

    const result = db.insert(todos).values({
      title,
      dueDate: dueDate || null,
      priority: priority || null,
      context: context || null,
    }).returning()

    return NextResponse.json({ todo: result[0] }, { status: 201 })
  } catch (error) {
    console.error('[/api/todos POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create todo' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: 实现 PATCH + DELETE /api/todos/[id]**

```typescript
// src/app/api/todos/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { todos } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/todos/[id] — 更新（主要用 toggle status） */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const db = getDb()
    const { id } = await context.params
    const body = await request.json()
    const todoId = parseInt(id, 10)

    if (isNaN(todoId)) {
      return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.status !== undefined) updates.status = body.status
    if (body.title !== undefined) updates.title = body.title
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate
    if (body.priority !== undefined) updates.priority = body.priority

    const result = db
      .update(todos)
      .set(updates)
      .where(eq(todos.id, todoId))
      .returning()

    if (!result.length) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
    }

    return NextResponse.json({ todo: result[0] })
  } catch (error) {
    console.error('[/api/todos/[id] PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 })
  }
}

/** DELETE /api/todos/[id] */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const db = getDb()
    const { id } = await context.params
    const todoId = parseInt(id, 10)

    if (isNaN(todoId)) {
      return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 })
    }

    const result = db.delete(todos).where(eq(todos.id, todoId)).returning()

    if (!result.length) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/todos/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete todo' }, { status: 500 })
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/app/api/todos/
git commit -m "feat: add CRUD API for todos (GET, POST, PATCH, DELETE)"
```

---

## Task 2.5: 修改 /api/extract — 抽取后保存到 DB

**Files:** Modify: `src/app/api/extract/route.ts`

- [ ] **Step 1: 修改 extract route，抽取结果写入 DB**

在现有 `POST` handler 中，`extractTodos()` 返回结果后，将每条 todo 插入数据库：

```typescript
// src/app/api/extract/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { extractTodos } from '@/lib/extractor'
import { getDb } from '@/lib/db'
import { todos } from '@/lib/db/schema'

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

    // 保存到数据库
    const db = getDb()
    const savedTodos = []
    for (const todo of result.todos) {
      const saved = db.insert(todos).values({
        title: todo.title,
        dueDate: todo.dueDate || null,
        priority: todo.priority || null,
        context: todo.context || null,
      }).returning()
      savedTodos.push(saved[0])
    }

    return NextResponse.json({ todos: savedTodos })
  } catch (error) {
    console.error('[/api/extract] Error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'

    if (message.includes('API key') || message.includes('provider')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/extract/route.ts
git commit -m "feat: save extracted todos to database"
```

---

## Task 2.6: 更新前端页面 — 持久化 + 勾选 + 筛选

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/TodoList.tsx`

- [ ] **Step 1: 更新 page.tsx — 加载 DB 数据 + 筛选**

```typescript
// src/app/page.tsx

'use client'

import { useState, useEffect, useCallback } from 'react'
import { EmailInput } from '@/components/EmailInput'
import { TodoList } from '@/components/TodoList'

export type TodoStatus = 'all' | 'pending' | 'done'

export interface Todo {
  id: number
  title: string
  dueDate: string | null
  priority: 'high' | 'medium' | 'low' | null
  context: string | null
  status: 'pending' | 'done'
  sourceMessageId: string | null
  sourceSubject: string | null
  sourceFrom: string | null
  createdAt: string
  updatedAt: string
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [statusFilter, setStatusFilter] = useState<TodoStatus>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch(`/api/todos?status=${statusFilter}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTodos(data.todos)
    } catch (err) {
      console.error('Failed to fetch todos:', err)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

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

      // 刷新列表
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'done' ? 'pending' : 'done'
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) await fetchTodos()
    } catch (err) {
      console.error('Failed to toggle todo:', err)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' })
      if (res.ok) await fetchTodos()
    } catch (err) {
      console.error('Failed to delete todo:', err)
    }
  }

  const pendingCount = todos.filter((t) => t.status === 'pending').length
  const doneCount = todos.filter((t) => t.status === 'done').length

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

      <TodoList
        todos={todos}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onToggle={handleToggleStatus}
        onDelete={handleDelete}
        pendingCount={pendingCount}
        doneCount={doneCount}
      />
    </main>
  )
}
```

- [ ] **Step 2: 更新 TodoList.tsx — checkbox + 筛选 tab + 删除**

```typescript
// src/components/TodoList.tsx

'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Todo, TodoStatus } from '@/app/page'

interface TodoListProps {
  todos: Todo[]
  statusFilter: TodoStatus
  onStatusFilterChange: (status: TodoStatus) => void
  onToggle: (id: number, currentStatus: string) => void
  onDelete: (id: number) => void
  pendingCount: number
  doneCount: number
}

const priorityBadge: Record<string, { label: string; color: string }> = {
  high: { label: '🔴 紧急', color: 'text-red-600' },
  medium: { label: '🟡 一般', color: 'text-yellow-600' },
  low: { label: '🟢 不急', color: 'text-green-600' },
}

const filterTabs: { value: TodoStatus; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待办' },
  { value: 'done', label: '已完成' },
]

export function TodoList({
  todos,
  statusFilter,
  onStatusFilterChange,
  onToggle,
  onDelete,
  pendingCount,
  doneCount,
}: TodoListProps) {
  const totalCount = pendingCount + doneCount

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            📋 {pendingCount} 条待办 · {doneCount} 条已完成
          </CardTitle>
        </div>
        {/* 筛选 Tab */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onStatusFilterChange(tab.value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {todos.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {statusFilter === 'all' ? '还没有待办，粘贴邮件试试' : '这个分类下没有待办'}
          </p>
        )}
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              todo.status === 'done' ? 'bg-muted/50 opacity-60' : ''
            }`}
          >
            {/* Checkbox */}
            <button
              onClick={() => onToggle(todo.id, todo.status)}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                todo.status === 'done'
                  ? 'border-green-500 bg-green-500 text-white'
                  : 'border-muted-foreground/30 hover:border-primary'
              }`}
            >
              {todo.status === 'done' && (
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            <div className="flex-1 space-y-1">
              <p className={`font-medium ${todo.status === 'done' ? 'line-through' : ''}`}>
                {todo.title}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                  &ldquo;{todo.context}&rdquo;
                </p>
              )}
            </div>

            {/* 删除按钮 */}
            <button
              onClick={() => onDelete(todo.id)}
              className="shrink-0 text-muted-foreground/40 hover:text-red-500 transition-colors"
              title="删除"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/app/page.tsx src/components/TodoList.tsx
git commit -m "feat: persistent todo list with checkbox, filter tabs, and delete"
```

---

## Task 2.7: DB 基础操作测试

**Files:** Create: `src/__tests__/db/schema.test.ts`

- [ ] **Step 1: 编写 DB 操作测试**

```typescript
// src/__tests__/db/schema.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { todos, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// 用内存 SQLite 测试，不污染真实 DB
let db: ReturnType<typeof drizzle>

beforeAll(() => {
  const sqlite = Database(':memory:')
  sqlite.exec(`
    CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      due_date TEXT,
      priority TEXT,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source_message_id TEXT,
      source_subject TEXT,
      source_from TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      subject TEXT,
      sender TEXT,
      body TEXT,
      received_at INTEGER,
      processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      direction TEXT NOT NULL DEFAULT 'in'
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db = drizzle(sqlite, { schema })
})

describe('Todos CRUD', () => {
  it('should insert a todo', () => {
    const result = db.insert(todos).values({
      title: '测试待办',
      priority: 'high',
      dueDate: '下周五前',
    }).returning()

    expect(result[0].id).toBeDefined()
    expect(result[0].title).toBe('测试待办')
    expect(result[0].status).toBe('pending')
    expect(result[0].priority).toBe('high')
  })

  it('should toggle todo status', () => {
    const inserted = db.insert(todos).values({ title: '待完成' }).returning()
    const id = inserted[0].id

    db.update(todos).set({ status: 'done' }).where(eq(todos.id, id))

    const updated = db.select().from(todos).where(eq(todos.id, id)).all()
    expect(updated[0].status).toBe('done')
  })

  it('should delete a todo', () => {
    const inserted = db.insert(todos).values({ title: '待删除' }).returning()
    const id = inserted[0].id

    db.delete(todos).where(eq(todos.id, id))

    const remaining = db.select().from(todos).where(eq(todos.id, id)).all()
    expect(remaining).toHaveLength(0)
  })
})

describe('Messages dedup', () => {
  it('should enforce unique messageId', () => {
    db.insert(messages).values({
      messageId: 'msg-001',
      subject: '测试邮件',
      from: 'test@test.com',
    })

    // 重复插入应该抛错
    expect(() => {
      db.insert(messages).values({
        messageId: 'msg-001',
        subject: '重复邮件',
      })
    }).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试**

Run: `npm test`
Expected: DB tests + prompt tests all pass

- [ ] **Step 3: 提交**

```bash
git add src/__tests__/db/
git commit -m "test: add DB CRUD and message dedup tests"
```

---

## Task 2.8: 端到端验收

- [ ] **Step 1: 启动 dev server，浏览器测试**

Run: `npm run dev`

1. 打开 http://localhost:3000
2. 粘贴之前的测试邮件 → 提取待办
3. **刷新页面** → 待办仍在（验证持久化）
4. 勾选一条待办 → 状态变为 done，显示删除线
5. 切换「已完成」tab → 只看到已完成的
6. 切换「待办」tab → 只看到未完成的
7. 删除一条待办 → 从列表消失，刷新后也不在

- [ ] **Step 2: 验证 DB 文件生成**

```bash
ls -la data/actbox.db
```

Expected: 文件存在且大小 > 0

- [ ] **Step 3: 运行所有测试**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: Phase 2 complete - persistent todos with SQLite + Drizzle"
```

---

## Verification

| 验证项 | 方法 | 预期 |
|--------|------|------|
| 待办持久化 | 提取后刷新页面 | 数据不丢 |
| 勾选完成 | 点击 checkbox | 状态切换 + 删除线 |
| 筛选 tab | 切换待办/已完成 | 正确过滤 |
| 删除待办 | 点 × 按钮 | 消失且刷新不回 |
| DB 文件 | `ls data/actbox.db` | 文件存在 |
| DB 测试 | `npm test` | 全绿 |
| 构建通过 | `npm run build` | 无错误 |
