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
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchResult, setFetchResult] = useState<string | null>(null)

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

  // 用当前 filter 的 todos 计算 count 不准确（all 时不分）
  // 改为从所有数据中计算
  const pendingCount = todos.filter((t) => t.status === 'pending').length
  const doneCount = todos.filter((t) => t.status === 'done').length

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-20">
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

      <EmailInput onSubmit={handleExtract} isLoading={isLoading} />

      {fetchResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {fetchResult}
        </div>
      )}

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
