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
                  &ldquo;{todo.context}&rdquo;
                </p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
