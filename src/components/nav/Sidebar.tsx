// src/components/nav/Sidebar.tsx

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

interface SidebarProps {
  unreadCount?: number
  todoPendingCount?: number
  onSearch?: (query: string) => void
  onRefresh?: () => void
  onAccountsChange?: () => void
}

interface AccountLite {
  id: number
  email: string
  provider: string
  displayName: string | null
  isActive: boolean
  unreadCount: number
}

// provider 徽标颜色(与账号管理 UI 对齐)
const PROVIDER_BADGE: Record<string, { badge: string; color: string }> = {
  '163': { badge: '163', color: 'bg-orange-500' },
  '126': { badge: '126', color: 'bg-orange-500' },
  qq: { badge: 'QQ', color: 'bg-blue-500' },
  gmail: { badge: 'G', color: 'bg-red-500' },
  outlook: { badge: 'OL', color: 'bg-sky-600' },
  custom: { badge: '⚙', color: 'bg-gray-500' },
}

export function Sidebar({ unreadCount = 0, todoPendingCount = 0, onSearch, onRefresh }: SidebarProps) {
  const pathname = usePathname()
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState(false)
  const [accounts, setAccounts] = useState<AccountLite[]>([])

  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts((data.accounts || []).filter((a: AccountLite) => a.isActive))
    } catch {
      // 静默
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [unreadCount]) // 收件箱未读变化时刷新账号未读角标

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href))

  const handleSearch = (value: string) => {
    setSearch(value)
    onSearch?.(value)
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-xl">📬</span>
        <span className="text-base font-bold text-foreground">ActBox</span>
        <button
          onClick={onRefresh}
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="刷新"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-3 pb-3">
        <div className="relative">
          <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索邮件"
            className="w-full rounded-md border border-border bg-input py-1.5 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      {/* 快捷文件夹 */}
      <div className="flex-1 overflow-y-auto px-2">
        <button
          onClick={() => setCollapsedFolders(!collapsedFolders)}
          className="mb-1 flex w-full items-center px-2 py-1 text-xs font-medium text-muted-foreground"
        >
          <span className="text-[10px]">{collapsedFolders ? '▶' : '▼'}</span>
          <span className="ml-1">快捷文件夹</span>
        </button>

        {!collapsedFolders && (
          <nav className="space-y-0.5">
            <Link
              href="/"
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                pathname === '/' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2">📋 待办</span>
              {todoPendingCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                  {todoPendingCount}
                </span>
              )}
            </Link>

            <Link
              href="/mails?folder=inbox"
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive('/mails') ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2">📥 收件箱</span>
              {unreadCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="text-[10px] text-muted-foreground">{unreadCount}</span>
                </span>
              )}
            </Link>

            <Link href="/mails?folder=unread" className="flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <span className="ml-4">👁 未读</span>
            </Link>

            <Link href="/mails?folder=starred" className="flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <span className="ml-4">🚩 红旗</span>
            </Link>

            <Link href="/mails?folder=drafts" className="flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <span className="ml-4">📝 草稿箱</span>
            </Link>

            <Link href="/mails?folder=sent" className="flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <span className="ml-4">📤 已发送</span>
            </Link>
          </nav>
        )}

        {/* 邮箱账号(动态) */}
        <div className="mb-1 mt-4 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium text-muted-foreground">邮箱</span>
          <Link href="/settings/accounts" className="text-[10px] text-muted-foreground hover:text-foreground" title="管理账号">
            管理
          </Link>
        </div>
        <div className="space-y-0.5">
          {accounts.length === 0 && (
            <Link href="/settings/accounts" className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              + 添加邮箱账号
            </Link>
          )}
          {accounts.map((a) => {
            const m = PROVIDER_BADGE[a.provider] || PROVIDER_BADGE.custom
            return (
              <Link
                key={a.id}
                href={`/mails?account=${a.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent/50"
                title={a.email}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${m.color} text-[10px] font-bold text-white`}>
                  {m.badge}
                </span>
                <span className="flex-1 truncate">{a.displayName || a.email}</span>
                {a.unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{a.unreadCount}</span>
                )}
              </Link>
            )
          })}
        </div>
      </div>

      {/* 底部：写邮件 + 设置 */}
      <div className="space-y-1 border-t border-border p-2">
        <Link
          href="/compose"
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          ✏️ 写邮件
        </Link>
        <Link
          href="/settings"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive('/settings') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          设置
        </Link>
      </div>
    </aside>
  )
}
