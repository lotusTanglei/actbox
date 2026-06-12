// src/app/settings/page.tsx

'use client'

import { useState, useEffect } from 'react'

type Section = 'email' | 'llm' | 'scheduler' | 'signature'

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('email')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Email settings
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [imapUser, setImapUser] = useState('')
  const [imapAuthCode, setImapAuthCode] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')

  // LLM settings
  const [llmProvider, setLlmProvider] = useState('deepseek')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')

  // Scheduler settings
  const [schedulerEnabled, setSchedulerEnabled] = useState(false)
  const [schedulerCron, setSchedulerCron] = useState('*/30 * * * *')
  const [schedulerRunning, setSchedulerRunning] = useState(false)

  // Signature
  const [signature, setSignature] = useState('')

  // Load current settings from env (via API)
  useEffect(() => {
    loadSettings()
    checkScheduler()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      const s = data.settings || {}

      if (s.imap_host) setImapHost(s.imap_host)
      if (s.imap_port) setImapPort(s.imap_port)
      if (s.imap_user) setImapUser(s.imap_user)
      if (s.smtp_host) setSmtpHost(s.smtp_host)
      if (s.smtp_port) setSmtpPort(s.smtp_port)
      if (s.llm_provider) setLlmProvider(s.llm_provider)
      if (s.signature) setSignature(s.signature)
      if (s.scheduler_cron) setSchedulerCron(s.scheduler_cron)
      if (s.scheduler_enabled === 'true') setSchedulerEnabled(true)
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  const checkScheduler = async () => {
    try {
      const res = await fetch('/api/scheduler')
      const data = await res.json()
      setSchedulerRunning(data.running)
    } catch {
      // ignore
    }
  }

  const handleSaveEmail = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imap_host: imapHost,
          imap_port: imapPort,
          imap_user: imapUser,
          smtp_host: smtpHost,
          smtp_port: smtpPort,
        }),
      })
      setMessage('✅ 邮箱配置已保存')
    } catch {
      setMessage('❌ 保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleScheduler = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const action = schedulerRunning ? 'stop' : 'start'
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, cronExpression: schedulerCron }),
      })
      const data = await res.json()
      setSchedulerRunning(!schedulerRunning)
      setSchedulerEnabled(!schedulerRunning)
      setMessage(`✅ ${data.message}`)
    } catch {
      setMessage('❌ 操作失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSignature = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      })
      setMessage('✅ 签名已保存')
    } catch {
      setMessage('❌ 保存失败')
    } finally {
      setSaving(false)
    }
  }

  const sections: { key: Section; label: string }[] = [
    { key: 'email', label: '📧 邮箱' },
    { key: 'llm', label: '🤖 LLM' },
    { key: 'scheduler', label: '⏰ 定时拉取' },
    { key: 'signature', label: '✍️ 签名' },
  ]

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-20">
      <h1 className="text-xl font-bold">⚙️ 设置</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => { setSection(s.key); setMessage(null) }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              section === s.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-lg border p-3 text-sm ${
          message.startsWith('✅') ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {message}
        </div>
      )}

      {/* Email Settings */}
      {section === 'email' && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">收件 (IMAP)</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">IMAP 服务器</label>
              <input value={imapHost} onChange={(e) => setImapHost(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="imap.163.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">端口</label>
              <input value={imapPort} onChange={(e) => setImapPort(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="993" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">邮箱地址</label>
            <input value={imapUser} onChange={(e) => setImapUser(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="you@163.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">授权码</label>
            <input type="password" value={imapAuthCode} onChange={(e) => setImapAuthCode(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="••••••••" />
          </div>

          <h3 className="mt-4 font-medium">发件 (SMTP)</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">SMTP 服务器</label>
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="smtp.163.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">端口</label>
              <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" placeholder="465" />
            </div>
          </div>

          <button onClick={handleSaveEmail} disabled={saving}
            className="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? '保存中...' : '保存邮箱配置'}
          </button>
          <p className="text-xs text-muted-foreground">
            💡 授权码和 API Key 保存在 .env.local，不在数据库中
          </p>
        </div>
      )}

      {/* LLM Settings */}
      {section === 'llm' && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">LLM Provider</h3>
          <p className="text-xs text-muted-foreground">
            Provider 切换和 API Key 在 .env.local 中配置。当前: <strong>{llmProvider}</strong>
          </p>
          <div className="rounded-lg bg-muted p-3 text-xs font-mono">
            <p>LLM_PROVIDER={llmProvider}</p>
            <p>DEEPSEEK_API_KEY=sk-***</p>
            <p>DEEPSEEK_BASE_URL=https://api.deepseek.com</p>
            <p>DEEPSEEK_MODEL=deepseek-v4-flash</p>
          </div>
          <p className="text-xs text-muted-foreground">
            修改后重启 dev server 生效
          </p>
        </div>
      )}

      {/* Scheduler Settings */}
      {section === 'scheduler' && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">定时拉取</h3>
            <span className={`text-xs ${schedulerRunning ? 'text-green-600' : 'text-muted-foreground'}`}>
              {schedulerRunning ? '● 运行中' : '○ 已停止'}
            </span>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Cron 表达式</label>
            <input value={schedulerCron} onChange={(e) => setSchedulerCron(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm font-mono outline-none focus:border-primary" />
            <p className="mt-1 text-xs text-muted-foreground">
              默认 */30 * * * *（每 30 分钟）
            </p>
          </div>
          <button onClick={handleToggleScheduler} disabled={saving}
            className={`w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              schedulerRunning
                ? 'border border-red-200 text-red-600 hover:bg-red-50'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}>
            {saving ? '处理中...' : schedulerRunning ? '⏹ 停止定时拉取' : '▶ 启动定时拉取'}
          </button>
        </div>
      )}

      {/* Signature Settings */}
      {section === 'signature' && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">邮件签名</h3>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="祝好&#10;张三"
          />
          <button onClick={handleSaveSignature} disabled={saving}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? '保存中...' : '保存签名'}
          </button>
        </div>
      )}
    </main>
  )
}
