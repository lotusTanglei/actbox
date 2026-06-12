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
