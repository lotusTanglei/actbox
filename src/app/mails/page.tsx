// src/app/mails/page.tsx - 三栏邮件布局

'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { EmailBody } from '@/components/EmailBody'
import { emitRefresh } from '@/lib/refresh-bus'

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

function MailsContent() {
  const searchParams = useSearchParams()
  const initialFolder = searchParams.get('folder') || 'inbox'
  const initialSearch = searchParams.get('search') || ''

  const [messages, setMessages] = useState<Message[]>([])
  const [folder, setFolder] = useState(initialFolder)
  const [search, setSearch] = useState(initialSearch)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [relatedTodos, setRelatedTodos] = useState<Array<{ id: number; title: string; dueDate: string | null; priority: string | null; status: string }>>([])

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (folder === 'drafts') {
        params.set('direction', 'draft')
      } else if (folder === 'sent') {
        params.set('direction', 'out')
      } else {
        params.set('direction', 'in')
        if (folder === 'unread') params.set('unread', 'true')
        if (folder === 'starred') params.set('starred', 'true')
      }
      if (search) params.set('search', search)
      const res = await fetch(`/api/messages?${params}`)
      const data = await res.json()
      if (res.ok) setMessages(data.messages)
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    }
  }, [search, folder])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    setFolder(initialFolder)
    setSearch(initialSearch)
  }, [initialFolder, initialSearch])

  const handleSelectMessage = async (msg: Message) => {
    setSelectedId(msg.id)
    try {
      const res = await fetch(`/api/messages/${msg.id}`)
      const data = await res.json()
      if (res.ok) {
        setSelectedMessage(data.message)
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: 1 } : m))
        emitRefresh()
        if (folder === 'unread') fetchMessages()
        const todoRes = await fetch('/api/todos?status=all')
        const todoData = await todoRes.json()
        if (todoData.todos) {
          setRelatedTodos(todoData.todos.filter((t: Message & { sourceMessageId?: string }) => t.messageId === data.message.messageId))
        }
      }
    } catch {
      // ignore
    }
  }

  const handleToggleStar = async (id: number, current: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: !current }),
    })
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, isStarred: current ? 0 : 1 } : m))
    if (selectedMessage?.id === id) setSelectedMessage({ ...selectedMessage, isStarred: current ? 0 : 1 })
  }

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await fetch(`/api/messages/${id}`, { method: 'DELETE' })
    setMessages((prev) => prev.filter((m) => m.id !== id))
    emitRefresh()
    if (selectedId === id) {
      setSelectedId(null)
      setSelectedMessage(null)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }

  const getAvatar = (from: string | null) => {
    const name = from || '?'
    const match = name.match(/[一-龥a-zA-Z]/)
    return match ? match[0].toUpperCase() : '?'
  }

  const avatarColors = ['bg-orange-500', 'bg-red-500', 'bg-green-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500']
  const getAvatarColor = (id: number) => avatarColors[id % avatarColors.length]

  const folderLabel: Record<string, string> = {
    inbox: '收件箱', unread: '未读', starred: '红旗', drafts: '草稿箱', sent: '已发送',
  }

  return (
    <div className="flex h-full">
      {/* 中间栏：邮件列表 */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">
            {folderLabel[folder] || '收件箱'}{messages.length > 0 ? ` · ${messages.length}` : ''}
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="w-32 rounded border border-border bg-input px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
              <span className="mb-2 text-4xl">📭</span>
              <p>暂无邮件</p>
              <p className="mt-1 text-xs">点击侧边栏刷新按钮拉取新邮件</p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              onClick={() => handleSelectMessage(msg)}
              className={`flex cursor-pointer gap-3 border-b border-border/50 px-4 py-3 transition-colors hover:bg-accent/50 ${
                selectedId === msg.id ? 'bg-accent' : ''
              } ${!msg.isRead ? 'bg-primary/5' : ''}`}
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${getAvatarColor(msg.id)}`}>
                {getAvatar(msg.from)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${!msg.isRead ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}>
                    {msg.from || '未知'}
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(msg.receivedAt)}</span>
                </div>
                <p className={`truncate text-sm ${!msg.isRead ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  {msg.subject || '(无主题)'}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {msg.body?.substring(0, 60) || '(无预览)'}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {msg.todoCount > 0 && (
                      <span className="rounded bg-primary/20 px-1 py-0.5 text-[10px] text-primary">
                        {msg.todoCount}待办
                      </span>
                    )}
                    <button onClick={(e) => handleToggleStar(msg.id, msg.isStarred, e)} className="text-xs">
                      {msg.isStarred ? '⭐' : '☆'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右栏：邮件详情/空状态 */}
      <div className="flex-1 overflow-y-auto bg-background">
        {selectedMessage ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <h1 className="text-lg font-bold text-foreground">{selectedMessage.subject || '(无主题)'}</h1>
              <div className="flex items-center gap-2">
                <Link
                  href={`/compose?to=${encodeURIComponent(selectedMessage.from || '')}&subject=${encodeURIComponent(selectedMessage.subject || '')}&messageId=${encodeURIComponent(selectedMessage.messageId)}&originalBody=${encodeURIComponent(selectedMessage.body || '')}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  ↩ 回复
                </Link>
                <button
                  onClick={(e) => handleToggleStar(selectedMessage.id, selectedMessage.isStarred, e)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  {selectedMessage.isStarred ? '⭐ 取消星标' : '☆ 星标'}
                </button>
                <button
                  onClick={(e) => handleDelete(selectedMessage.id, e)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  删除
                </button>
              </div>
            </div>

            <div className="border-b border-border px-6 py-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${getAvatarColor(selectedMessage.id)}`}>
                  {getAvatar(selectedMessage.from)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{selectedMessage.from || '未知'}</p>
                  <p className="text-xs text-muted-foreground">
                    发送给 {selectedMessage.to || '我'} · {selectedMessage.receivedAt ? new Date(selectedMessage.receivedAt).toLocaleString('zh-CN') : ''}
                  </p>
                </div>
              </div>
            </div>

            {relatedTodos.length > 0 && (
              <div className="border-b border-primary/20 bg-primary/5 px-6 py-3">
                <p className="mb-2 text-xs font-medium text-primary">📋 从此邮件提取的待办 ({relatedTodos.length})</p>
                <div className="space-y-1">
                  {relatedTodos.map((todo) => (
                    <div key={todo.id} className="flex items-center gap-2 text-sm">
                      <span>{todo.status === 'done' ? '✅' : '⬜'}</span>
                      <span className={todo.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                        {todo.title}
                      </span>
                      {todo.dueDate && <span className="text-xs text-primary">📅 {todo.dueDate}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 px-6 py-4">
              <EmailBody html={selectedMessage.bodyHtml} text={selectedMessage.body} />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-4 text-6xl opacity-30">📬</div>
            <h2 className="text-lg font-medium text-foreground">选择一封邮件查看</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              从左侧列表选择邮件，或点「写邮件」开始新邮件
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MailsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">加载中...</div>}>
      <MailsContent />
    </Suspense>
  )
}
