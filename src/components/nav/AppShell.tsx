// src/components/nav/AppShell.tsx

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from './Sidebar'

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
    // 定期刷新计数（每 60 秒）
    const interval = setInterval(loadCounts, 60000)
    return () => clearInterval(interval)
  }, [loadCounts, refreshKey])

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
    </div>
  )
}
