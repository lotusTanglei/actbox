// src/components/nav/AppShell.tsx

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { onRefresh } from '@/lib/refresh-bus'
import { useMailEvents } from '@/components/realtime/useMailEvents'
import { Notifications } from '@/components/realtime/Notifications'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const [unreadCount, setUnreadCount] = useState(0)
  const [todoPendingCount, setTodoPendingCount] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  // 加载未读数和待办数
  const loadCounts = useCallback(async () => {
    try {
      const [mailRes, todoRes] = await Promise.all([
        fetch('/api/messages?direction=in'),
        fetch('/api/todos?status=all'),
      ])
      const mailData = await mailRes.json()
      const todoData = await todoRes.json()
      if (mailRes.ok) setUnreadCount(mailData.unreadCount || 0)
      if (todoRes.ok) {
        const pending = (todoData.todos || []).filter((t: { status: string }) => t.status === 'pending').length
        setTodoPendingCount(pending)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadCounts()
    // 订阅子页面触发的刷新（如勾选待办、标记已读后）
    const unsub = onRefresh(loadCounts)
    return () => {
      unsub()
    }
  }, [loadCounts, refreshKey])

  // 实时:SSE 推送替代 60s 轮询(new-mail → 刷新列表/计数;unread-count → 角标)。plan-06 Task 8
  useMailEvents({
    onNewMail: () => {
      loadCounts()
      router.refresh()
    },
    onUnreadCount: (p) => {
      if (p.folder === 'INBOX') setUnreadCount(p.unread)
    },
    onMessageUpdated: () => loadCounts(),
    onStatus: () => loadCounts(),
  })

  const handleRefresh = async () => {
    try {
      await fetch('/api/fetch', { method: 'POST' })
      setRefreshKey((k) => k + 1)
      router.refresh()
    } catch {
      // ignore
    }
  }

  const handleSearch = (query: string) => {
    router.push(`/mails?search=${encodeURIComponent(query)}`)
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        unreadCount={unreadCount}
        todoPendingCount={todoPendingCount}
        onRefresh={handleRefresh}
        onSearch={handleSearch}
      />
      <main className="flex-1 overflow-hidden">{children}</main>
      <Notifications />
    </div>
  )
}
