// src/app/mails/page.tsx

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Message {
  id: number
  messageId: string
  subject: string | null
  from: string | null
  to: string | null
  body: string | null
  receivedAt: string | null
  direction: string
  isRead: number
  isStarred: number
  todoCount: number
}

type TabType = 'in' | 'out'

export default function MailsPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [tab, setTab] = useState<TabType>('in')
  const [search, setSearch] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [isFetching, setIsFetching] = useState(false)

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams({ direction: tab })
      if (search) params.set('search', search)
      const res = await fetch(`/api/messages?${params}`)
      const data = await res.json()
      if (res.ok) {
        setMessages(data.messages)
        setUnreadCount(data.unreadCount)
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    }
  }, [tab, search])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  const handleFetch = async () => {
    setIsFetching(true)
    try {
      await fetch('/api/fetch', { method: 'POST' })
      await fetchMessages()
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setIsFetching(false)
    }
  }

  const handleToggleStar = async (id: number, current: number) => {
    try {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred: !current }),
      })
      await fetchMessages()
    } catch (err) {
      console.error('Failed to toggle star:', err)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/messages/${id}`, { method: 'DELETE' })
      await fetchMessages()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">邮件</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
              {unreadCount} 未读
            </span>
          )}
        </div>
        <button
          onClick={handleFetch}
          disabled={isFetching}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? '⏳ 拉取中...' : '📥 拉取'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {[
          { value: 'in' as TabType, label: `收件箱` },
          { value: 'out' as TabType, label: '已发送' },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="搜索邮件..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-primary"
      />

      {/* Mail List */}
      <div className="space-y-1">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {tab === 'in' ? '没有邮件，点📥拉取获取' : '没有已发送邮件'}
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 ${
              !msg.isRead ? 'bg-blue-50/50 border-blue-200' : ''
            }`}
          >
            {/* Star */}
            <button
              onClick={() => handleToggleStar(msg.id, msg.isStarred)}
              className="mt-0.5 shrink-0 text-lg leading-none"
            >
              {msg.isStarred ? '⭐' : '☆'}
            </button>

            {/* Content */}
            <Link href={`/mails/${msg.id}`} className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate text-sm ${!msg.isRead ? 'font-bold' : 'font-medium'}`}>
                  {msg.subject || '(无主题)'}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(msg.receivedAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{tab === 'in' ? `来自 ${msg.from || '未知'}` : `发给 ${msg.to || ''}`}</span>
                {msg.todoCount > 0 && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">
                    {msg.todoCount} 条待办
                  </span>
                )}
              </div>
              {msg.body && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {msg.body.substring(0, 80)}
                </p>
              )}
            </Link>

            {/* Delete */}
            <button
              onClick={(e) => { e.preventDefault(); handleDelete(msg.id) }}
              className="shrink-0 text-muted-foreground/30 hover:text-red-500 transition-colors"
              title="删除"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
