// src/app/settings/accounts/page.tsx — 账号管理 UI
// 列表 + 新增(provider preset 自动填 host/port)+ 测试连接 + 启停 + 删除 + 同步状态展示。

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Provider = '163' | '126' | 'qq' | 'gmail' | 'outlook' | 'custom'

interface Account {
  id: number
  email: string
  provider: Provider
  user: string
  displayName: string | null
  imapHost: string | null
  imapPort: number | null
  smtpHost: string | null
  smtpPort: number | null
  isActive: boolean
  syncMode: 'idle' | 'poll'
  lastSyncedAt: string | null
  syncStatus: 'healthy' | 'syncing' | 'error' | 'disabled'
  syncError: string | null
}

// provider 展示元数据(颜色/标签/oauth 提示)——与后端 presets.ts 对齐
const PROVIDERS: { id: Provider; label: string; badge: string; color: string; oauth?: boolean }[] = [
  { id: '163', label: '网易 163', badge: '163', color: 'bg-orange-500' },
  { id: '126', label: '网易 126', badge: '126', color: 'bg-orange-500' },
  { id: 'qq', label: 'QQ 邮箱', badge: 'QQ', color: 'bg-blue-500' },
  { id: 'gmail', label: 'Gmail', badge: 'G', color: 'bg-red-500', oauth: true },
  { id: 'outlook', label: 'Outlook', badge: 'OL', color: 'bg-sky-600', oauth: true },
  { id: 'custom', label: '自定义 (IMAP)', badge: '⚙', color: 'bg-gray-500' },
]

function providerMeta(p: Provider) {
  return PROVIDERS.find((x) => x.id === p) ?? PROVIDERS[PROVIDERS.length - 1]
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<Record<number, { state: TestState; detail?: string }>>({})

  // 新增表单
  const [provider, setProvider] = useState<Provider>('163')
  const [email, setEmail] = useState('')
  const [user, setUser] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
    } catch {
      setMessage('❌ 加载账号失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 选 provider 时，若 email 为空且 provider 非自定义，自动把 user 同步为 email
  useEffect(() => {
    if (provider !== 'custom' && !user && email) setUser(email)
  }, [email, provider, user])

  const resetForm = () => {
    setProvider('163')
    setEmail('')
    setUser('')
    setAuthCode('')
    setDisplayName('')
    setImapHost('')
    setSmtpHost('')
  }

  const handleAdd = async () => {
    setMessage(null)
    if (!email || !user || !authCode) {
      setMessage('❌ 请填写 邮箱 / 用户名 / 授权码')
      return
    }
    setAdding(true)
    try {
      const body: Record<string, unknown> = { email, provider, user, authCode, displayName: displayName || undefined }
      if (provider === 'custom') {
        body.imapHost = imapHost
        body.smtpHost = smtpHost
      }
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(`❌ ${data.error || '添加失败'}`)
        return
      }
      resetForm()
      await load()
      setMessage('✅ 账号已添加')
    } catch {
      setMessage('❌ 添加失败')
    } finally {
      setAdding(false)
    }
  }

  const handleTest = async (id: number) => {
    setTestStates((s) => ({ ...s, [id]: { state: 'testing' } }))
    try {
      const res = await fetch(`/api/accounts/${id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestStates((s) => ({
        ...s,
        [id]: data.ok ? { state: 'ok', detail: data.detail } : { state: 'fail', detail: data.detail },
      }))
    } catch {
      setTestStates((s) => ({ ...s, [id]: { state: 'fail', detail: '请求失败' } }))
    }
  }

  const handleToggle = async (id: number, currentlyActive: boolean) => {
    try {
      await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentlyActive }),
      })
      await load()
    } catch {
      setMessage('❌ 切换状态失败')
    }
  }

  const handleDelete = async (id: number, emailAddr: string) => {
    if (!confirm(`确认删除账号 ${emailAddr}?已收取的邮件保留,但该账号不再同步。`)) return
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      await load()
      setMessage('✅ 账号已删除')
    } catch {
      setMessage('❌ 删除失败')
    }
  }

  const fmtTime = (iso: string | null) => {
    if (!iso) return '从未同步'
    try {
      return new Date(iso).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return iso
    }
  }

  const statusDot = (s: Account['syncStatus']) => {
    const map = {
      healthy: 'bg-green-500',
      syncing: 'bg-yellow-500 animate-pulse',
      error: 'bg-red-500',
      disabled: 'bg-gray-400',
    } as const
    return map[s] || 'bg-gray-400'
  }

  const meta = providerMeta(provider)
  const isCustom = provider === 'custom'

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">← 设置</Link>
        <h1 className="text-lg font-bold text-foreground">🧾 账号管理</h1>
      </header>

      <div className="max-w-3xl space-y-4 px-6 py-6">
        {message && (
          <div className={`rounded-lg border p-3 text-sm ${
            message.startsWith('✅') ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* 新增表单 */}
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium text-foreground">添加账号</h3>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">服务商</label>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProvider(p.id); setMessage(null) }}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    provider === p.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {meta.oauth && (
              <p className="mt-1 text-xs text-yellow-600">⚠️ {meta.label} 通常需要 OAuth2,当前仅支持授权码模式(后续支持 OAuth)</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">邮箱地址</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder="you@163.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">用户名(登录)</label>
              <input value={user} onChange={(e) => setUser(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder={email || '同邮箱地址'} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">授权码</label>
              <input type="password" value={authCode} onChange={(e) => setAuthCode(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">显示名称(可选)</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder="工作邮箱" />
            </div>
          </div>

          {isCustom && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted p-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">IMAP 服务器</label>
                <input value={imapHost} onChange={(e) => setImapHost(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  placeholder="imap.example.com:993" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">SMTP 服务器</label>
                <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  placeholder="smtp.example.com:465" />
              </div>
            </div>
          )}

          <button onClick={handleAdd} disabled={adding}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {adding ? '添加中...' : '+ 添加账号'}
          </button>
          <p className="text-xs text-muted-foreground">💡 授权码明文存储于本地数据库(本地单用户,不做加密)</p>
        </div>

        {/* 账号列表 */}
        <div className="space-y-2">
          <h3 className="font-medium text-foreground">已配置账号 ({accounts.length})</h3>

          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : accounts.length === 0 ? (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">尚无账号,请在上方添加。</p>
          ) : (
            accounts.map((a) => {
              const m = providerMeta(a.provider)
              const ts = testStates[a.id]
              return (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.color} text-[10px] font-bold text-white`}>
                      {m.badge}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{a.displayName || a.email}</span>
                        {!a.isActive && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已停用</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={`inline-block h-2 w-2 rounded-full ${statusDot(a.syncStatus)}`} title={a.syncStatus} />
                        <span>{a.syncStatus}</span>
                        <span>·</span>
                        <span>{fmtTime(a.lastSyncedAt)}</span>
                        {a.syncError && <span className="truncate text-red-500" title={a.syncError}>· {a.syncError}</span>}
                      </div>
                    </div>
                  </div>

                  {/* 测试结果 */}
                  {ts && ts.state !== 'idle' && (
                    <div className={`mt-2 rounded-md px-2 py-1 text-xs ${
                      ts.state === 'ok' ? 'bg-green-50 text-green-700' :
                      ts.state === 'fail' ? 'bg-red-50 text-red-700' : 'bg-muted text-muted-foreground'
                    }`}>
                      {ts.state === 'testing' && '⏳ 测试连接中...'}
                      {ts.state === 'ok' && `✅ 连接成功 · ${ts.detail || ''}`}
                      {ts.state === 'fail' && `❌ 连接失败 · ${ts.detail || ''}`}
                    </div>
                  )}

                  {/* 操作 */}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => handleTest(a.id)}
                      disabled={ts?.state === 'testing'}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50">
                      {ts?.state === 'testing' ? '测试中...' : '🔌 测试连接'}
                    </button>
                    <button onClick={() => handleToggle(a.id, a.isActive)}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        a.isActive
                          ? 'border-border text-muted-foreground hover:bg-accent'
                          : 'border-green-300 text-green-600 hover:bg-green-50'
                      }`}>
                      {a.isActive ? '停用' : '启用'}
                    </button>
                    <button onClick={() => handleDelete(a.id, a.email)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 transition-colors hover:bg-red-50">
                      删除
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </main>
  )
}
