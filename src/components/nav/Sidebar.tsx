// src/components/nav/Sidebar.tsx

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { SavedSearches } from '@/components/search/SavedSearches'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

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

interface FolderLite {
  accountId: number
  path: string
  displayName: string
  type: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'
  unreadCount: number
  totalCount: number
}

interface LabelLite {
  id: number
  name: string
  color: string
  parentId: number | null
}

const SYSTEM_FOLDERS: { type: FolderLite['type']; label: string; icon: string; param: string }[] = [
  { type: 'inbox', label: '收件箱', icon: '📥', param: 'inbox' },
  { type: 'sent', label: '已发送', icon: '📤', param: 'sent' },
  { type: 'drafts', label: '草稿箱', icon: '📝', param: 'drafts' },
  { type: 'archive', label: '归档', icon: '🗄️', param: 'archive' },
  { type: 'trash', label: '已删除', icon: '🗑️', param: 'trash' },
  { type: 'spam', label: '垃圾邮件', icon: '⚠️', param: 'spam' },
]

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
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState(false)
  const [accounts, setAccounts] = useState<AccountLite[]>([])
  const [folders, setFolders] = useState<FolderLite[]>([])
  const [labels, setLabels] = useState<LabelLite[]>([])

  // 按 type 聚合未读(多账号合并)
  const unreadByType = folders.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + (f.unreadCount || 0)
    return acc
  }, {})

  const loadAccounts = async () => {
    try {
      const [accRes, folderRes, labelsRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/folders'),
        fetch('/api/labels?accountId=1'),
      ])
      const accData = await accRes.json()
      setAccounts((accData.accounts || []).filter((a: AccountLite) => a.isActive))
      if (folderRes.ok) {
        const folderData = await folderRes.json()
        setFolders(folderData.folders || [])
      }
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json()
        setLabels(labelsData.labels || [])
      }
    } catch {
      // 静默
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [unreadCount]) // 收件箱未读变化时刷新账号未读角标

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href))

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
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) {
                router.push(`/search?q=${encodeURIComponent(search.trim())}`)
              }
            }}
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

            <Link href="/mails?folder=snoozed" className="flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
              <span className="ml-4">⏰ 已延后</span>
            </Link>

            {SYSTEM_FOLDERS.filter((f) => ['archive', 'trash', 'spam'].includes(f.type)).map((f) => (
              <Link
                key={f.type}
                href={`/mails?folder=${f.param}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <span className="ml-4">{f.icon} {f.label}</span>
                {(unreadByType[f.type] || 0) > 0 && (
                  <span className="text-[10px] text-muted-foreground">{unreadByType[f.type]}</span>
                )}
              </Link>
            ))}
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

        {/* Saved Search(常驻)—— plan-07 Task 8 */}
        <SavedSearches />

        {/* 标签区 —— plan-08 Task 12 */}
        {labels.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">标签</span>
            </div>
            <div className="space-y-0.5">
              {labels.map((l) => (
                <Link
                  key={l.id}
                  href={`/mails?labelId=${l.id}`}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent/50 ${
                    pathname === '/mails' ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  style={l.parentId ? { paddingLeft: 28 } : undefined}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="flex-1 truncate">{l.name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部：写邮件 + 通讯录 + 设置 */}
      <div className="space-y-1 border-t border-border p-2">
        <Link
          href="/compose"
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          ✏️ 写邮件
        </Link>
        <Link
          href="/calendar"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive('/calendar') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          📅 日历
        </Link>
        <Link
          href="/contacts"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive('/contacts') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          👥 通讯录
        </Link>
        <Link
          href="/rules"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive('/rules') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        >
          ⚙️ 规则
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

      {/* 主题切换 */}
      <div className="border-t border-border p-2">
        <ThemeToggle />
      </div>
    </aside>
  )
}
