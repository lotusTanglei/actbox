// src/app/page.tsx - 待办页，适配深色三栏风格

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { EmailInput } from '@/components/EmailInput'

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
  messageId?: string
  createdAt: string
  updatedAt: string
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [statusFilter, setStatusFilter] = useState<TodoStatus>('pending')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInput, setShowInput] = useState(false)

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
      if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
      await fetchTodos()
      setShowInput(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'done' ? 'pending' : 'done'
    await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    await fetchTodos()
  }

  const handleDelete = async (id: number) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    await fetchTodos()
  }

  const pendingCount = todos.filter((t) => t.status === 'pending').length
  const doneCount = todos.filter((t) => t.status === 'done').length

  const priorityBadge: Record<string, string> = {
    high: '🔴 紧急',
    medium: '🟡 一般',
    low: '🟢 不急',
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-bold text-foreground">📋 待办清单</h1>
        <button
          onClick={() => setShowInput(!showInput)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showInput ? '取消' : '➕ 手动提取'}
        </button>
      </header>

      {/* 可折叠的邮件输入区 */}
      {showInput && (
        <div className="border-b border-border bg-card px-6 py-4">
          <EmailInput onSubmit={handleExtract} isLoading={isLoading} />
          {error && (
            <p className="mt-2 text-sm text-destructive">⚠️ {error}</p>
          )}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center justify-between border-b border-border px-6 py-2">
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          {[
            { value: 'pending' as TodoStatus, label: `待办 (${pendingCount})` },
            { value: 'done' as TodoStatus, label: `已完成 (${doneCount})` },
            { value: 'all' as TodoStatus, label: '全部' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === tab.value ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 待办列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {todos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 text-5xl opacity-20">✅</span>
            <p className="text-sm text-muted-foreground">
              {statusFilter === 'done' ? '还没有已完成的待办' : statusFilter === 'pending' ? '没有待办，真棒！' : '还没有待办'}
            </p>
            {!showInput && statusFilter === 'pending' && (
              <button onClick={() => setShowInput(true)} className="mt-3 text-sm text-primary hover:underline">
                ➕ 手动提取邮件待办
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className={`group flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/30 ${
                  todo.status === 'done' ? 'opacity-50' : ''
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => handleToggleStatus(todo.id, todo.status)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    todo.status === 'done'
                      ? 'border-green-500 bg-green-500 text-white'
                      : 'border-muted-foreground/40 hover:border-primary'
                  }`}
                >
                  {todo.status === 'done' && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                <div className="min-w-0 flex-1 space-y-1">
                  <p className={`font-medium text-foreground ${todo.status === 'done' ? 'line-through' : ''}`}>
                    {todo.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {todo.dueDate && (
                      <span className="rounded bg-primary/20 px-2 py-0.5 text-primary">📅 {todo.dueDate}</span>
                    )}
                    {todo.priority && (
                      <span className="text-muted-foreground">{priorityBadge[todo.priority] || todo.priority}</span>
                    )}
                  </div>
                  {todo.context && (
                    <p className="text-xs italic text-muted-foreground">&ldquo;{todo.context}&rdquo;</p>
                  )}
                  {todo.sourceFrom && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <span>📧 {todo.sourceFrom}</span>
                      <Link href={`/mails?search=${encodeURIComponent(todo.sourceSubject || '')}`} className="text-primary hover:underline">
                        查看原文
                      </Link>
                      <Link
                        href={`/compose?to=${encodeURIComponent(todo.sourceFrom)}&subject=${encodeURIComponent('Re: ' + (todo.sourceSubject || ''))}&todoContext=${encodeURIComponent(todo.title)}`}
                        className="text-primary hover:underline"
                      >
                        ↩ 回复
                      </Link>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(todo.id)}
                  className="shrink-0 text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  title="删除"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
