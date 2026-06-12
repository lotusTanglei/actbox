// src/components/TodoList.tsx

'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
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
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
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
              {/* 来源邮件信息 + 操作 */}
              {(todo.sourceFrom || todo.sourceSubject) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>📧 {todo.sourceFrom}</span>
                  {todo.sourceSubject && (
                    <Link
                      href={`/mails?search=${encodeURIComponent(todo.sourceSubject)}`}
                      className="text-primary hover:underline"
                    >
                      查看原文
                    </Link>
                  )}
                  {todo.sourceFrom && (
                    <Link
                      href={`/compose?to=${encodeURIComponent(todo.sourceFrom)}&subject=${encodeURIComponent('Re: ' + (todo.sourceSubject || ''))}&todoContext=${encodeURIComponent(todo.title)}`}
                      className="text-primary hover:underline"
                    >
                      ↩ 回复
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* 删除按钮 */}
            <button
              onClick={() => onDelete(todo.id)}
              className="shrink-0 text-muted-foreground/40 transition-colors hover:text-red-500"
              title="删除"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
