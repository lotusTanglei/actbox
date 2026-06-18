// src/app/mails/[id]/page.tsx

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { EmailBody } from '@/components/EmailBody'
import { AttachmentList } from '@/components/AttachmentList'
import { emitRefresh } from '@/lib/refresh-bus'

interface AttachmentLite {
  id: number
  contentId: string | null
}

/** 把 bodyHtml 中的 cid:xxx 替换为内联附件 serve URL(渲染时解析内联图片)。 */
function rewriteCidImages(html: string | null, messageId: number, attachments: AttachmentLite[]): string | null {
  if (!html) return html
  const cidMap: Record<string, number> = {}
  for (const a of attachments) {
    if (a.contentId) {
      const stripped = a.contentId.replace(/^<|>$/g, '')
      if (stripped) cidMap[stripped] = a.id
    }
  }
  if (!Object.keys(cidMap).length) return html
  return html.replace(/cid:([^"'\s)>]+)/gi, (m, cid: string) => {
    const aid = cidMap[cid]
    return aid ? `/api/messages/${messageId}/attachments/${aid}?inline=1` : m
  })
}

interface Message {
  id: number
  messageId: string
  subject: string | null
  from: string | null
  to: string | null
  body: string | null
  bodyHtml: string | null
  receivedAt: string | null
  direction: string
  isRead: number
  isStarred: number
  todoCount: number
}

interface Todo {
  id: number
  title: string
  dueDate: string | null
  priority: string | null
  status: string
  context: string | null
}

export default function MailDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [message, setMessage] = useState<Message | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const [attachments, setAttachments] = useState<AttachmentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMessage = async () => {
      try {
        const res = await fetch(`/api/messages/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setMessage(data.message)
        emitRefresh()

        // 拉附件(列表 + 内联 cid 渲染)
        fetch(`/api/messages/${id}/attachments`)
          .then((r) => r.json())
          .then((d) => setAttachments(d.attachments || []))
          .catch(() => {})

        // 获取关联待办
        const todoRes = await fetch(`/api/todos?status=all`)
        const todoData = await todoRes.json()
        if (todoData.todos) {
          const related = todoData.todos.filter(
            (t: Todo & { sourceMessageId?: string }) =>
              t.sourceMessageId === data.message.messageId
          )
          setTodos(related)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchMessage()
  }, [id])

  const handleToggleStar = async () => {
    if (!message) return
    await fetch(`/api/messages/${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: !message.isStarred }),
    })
    setMessage({ ...message, isStarred: message.isStarred ? 0 : 1 })
  }

  const handleDelete = async () => {
    if (!message) return
    await fetch(`/api/messages/${message.id}`, { method: 'DELETE' })
    router.push('/mails')
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p className="text-center text-muted-foreground">加载中...</p>
      </main>
    )
  }

  if (error || !message) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p className="text-center text-red-500">{error || '邮件不存在'}</p>
        <div className="mt-4 text-center">
          <Link href="/mails" className="text-sm text-primary hover:underline">← 返回邮件列表</Link>
        </div>
      </main>
    )
  }

  const priorityBadge: Record<string, string> = {
    high: '🔴 紧急',
    medium: '🟡 一般',
    low: '🟢 不急',
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-20">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <Link href="/mails" className="text-sm text-primary hover:underline">
          ← 返回邮件列表
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/compose?to=${encodeURIComponent(message.from || '')}&subject=${encodeURIComponent(message.subject || '')}&messageId=${encodeURIComponent(message.messageId)}&originalBody=${encodeURIComponent(message.body || '')}`}
            className="rounded border px-3 py-1 text-xs transition-colors hover:bg-accent"
          >
            ↩ 回复
          </Link>
          <button onClick={handleToggleStar} className="text-lg" title="星标">
            {message.isStarred ? '⭐' : '☆'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded border px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          >
            删除
          </button>
        </div>
      </div>

      {/* Subject */}
      <div>
        <h1 className="text-xl font-bold">{message.subject || '(无主题)'}</h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
          <span>发件人: {message.from || '未知'}</span>
          {message.to && <span>收件人: {message.to}</span>}
          <span>
            {message.receivedAt
              ? new Date(message.receivedAt).toLocaleString('zh-CN')
              : ''}
          </span>
        </div>
      </div>

      {/* Related Todos */}
      {todos.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h3 className="mb-2 text-sm font-medium text-orange-800">
            📋 关联待办 ({todos.length})
          </h3>
          <div className="space-y-1">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-2 text-sm">
                <span>{todo.status === 'done' ? '✅' : '⬜'}</span>
                <span className={todo.status === 'done' ? 'line-through text-muted-foreground' : ''}>
                  {todo.title}
                </span>
                {todo.dueDate && (
                  <span className="text-xs text-orange-600">📅 {todo.dueDate}</span>
                )}
                {todo.priority && (
                  <span className="text-xs">{priorityBadge[todo.priority] || ''}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <EmailBody html={rewriteCidImages(message.bodyHtml, message.id, attachments)} text={message.body} />

      {/* Attachments */}
      <AttachmentList messageId={message.id} />
    </main>
  )
}
