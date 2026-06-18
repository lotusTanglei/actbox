// src/app/settings/page.tsx

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Section = 'email' | 'llm' | 'scheduler' | 'signature' | 'signatures'

// ── 签名管理组件 ──
function SignaturesSection() {
  const [sigs, setSigs] = useState<Array<{ id: number; name: string; body_html: string; body_text: string }>>([])
  const [name, setName] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/signatures')
    const d = await r.json()
    setSigs(d.signatures || [])
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!name) return
    if (editId) {
      await fetch(`/api/signatures/${editId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, bodyHtml, bodyText: bodyHtml }) })
    } else {
      await fetch('/api/signatures', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, bodyHtml, bodyText: bodyHtml }) })
    }
    setName(''); setBodyHtml(''); setEditId(null); setMsg('✅ 已保存'); load()
  }

  const del = async (id: number) => {
    await fetch(`/api/signatures/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">签名管理（多套）</h3>
      {msg && <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">{msg}</div>}
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="签名名称(如:正式/私人)" className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <button onClick={save} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">{editId ? '更新' : '新建'}</button>
      </div>
      <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={3} placeholder="签名正文" className="w-full rounded-md border px-3 py-2 text-sm" />
      {sigs.length > 0 && (
        <div className="space-y-1">
          {sigs.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
              <span>{s.name}</span>
              <div className="flex gap-1">
                <button onClick={() => { setName(s.name); setBodyHtml(s.body_html || ''); setEditId(s.id) }} className="text-xs text-primary hover:underline">编辑</button>
                <button onClick={() => del(s.id)} className="text-xs text-destructive hover:underline">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── LLM 配置表单组件 ──
const CAPABILITIES = ['summarize', 'polish', 'classify', 'extract', 'reply'] as const
const CAP_LABELS: Record<string, string> = { summarize: '摘要', polish: '润色', classify: '打标', extract: '抽取', reply: '回复' }

function LlmConfigForm() {
  const [providers, setProviders] = useState<Array<{ name: string; label: string; defaultBaseUrl: string; defaultModel: string }>>([])
  const [provider, setProvider] = useState('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [apiKeySet, setApiKeySet] = useState(false)
  const [apiKeyMasked, setApiKeyMasked] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.3)
  const [capModels, setCapModels] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/llm/config')
      const d = await r.json()
      setProviders(d.providers || [])
      setProvider(d.config.provider)
      setBaseUrl(d.config.baseUrl)
      setModel(d.config.model)
      setTemperature(d.config.temperature ?? 0.3)
      setApiKeyMasked(d.config.apiKeyMasked || '')
      setApiKeySet(d.config.apiKeySet)
      setApiKey('')
      const cm: Record<string, string> = {}
      for (const cap of CAPABILITIES) {
        cm[cap] = d.config.capabilities?.[cap]?.model || ''
      }
      setCapModels(cm)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  const handleProviderChange = (p: string) => {
    setProvider(p)
    const def = providers.find((x) => x.name === p)
    if (def) { setBaseUrl(def.defaultBaseUrl); setModel(def.defaultModel) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const body: any = { provider, baseUrl, model }
      if (apiKey) body.apiKey = apiKey
      const r = await fetch('/api/llm/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (j.ok) { setTestResult({ ok: true, msg: `✅ 连通成功 · ${j.latencyMs}ms · ${j.model}` }) }
      else { setTestResult({ ok: false, msg: `❌ ${j.error}` }) }
    } catch (e: any) { setTestResult({ ok: false, msg: `❌ ${e.message}` }) }
    finally { setTesting(false) }
  }

  const handleSave = async () => {
    setSaving(true); setSaveMsg(null)
    try {
      const body: any = { provider, baseUrl, model, temperature }
      if (apiKey) body.apiKey = apiKey
      const caps: Record<string, { model: string }> = {}
      for (const cap of CAPABILITIES) { if (capModels[cap]) caps[cap] = { model: capModels[cap] } }
      if (Object.keys(caps).length) body.capabilities = caps
      await fetch('/api/llm/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      setSaveMsg('✅ 已保存')
      setApiKey(''); load()
    } catch { setSaveMsg('❌ 保存失败') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="font-medium">LLM 配置中心</h3>

      {/* Provider */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Provider</label>
        <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary bg-background">
          {providers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">API Key {apiKeySet && <span className="text-green-600">(已配置)</span>}</label>
        <div className="flex gap-1">
          <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyMasked || 'sk-...'}
            className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={() => setShowKey((v) => !v)} className="rounded-md border px-2 text-xs hover:bg-accent">{showKey ? '隐藏' : '显示'}</button>
        </div>
      </div>

      {/* baseUrl */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Base URL</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" />
      </div>

      {/* Model + Temperature */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">默认模型</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">温度 ({temperature})</label>
          <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full" />
        </div>
      </div>

      {/* Per-capability model */}
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">各能力模型覆盖（可选）</summary>
        <div className="mt-2 space-y-2">
          {CAPABILITIES.map((cap) => (
            <div key={cap} className="flex items-center gap-2">
              <span className="w-14 text-xs text-muted-foreground">{CAP_LABELS[cap]}</span>
              <input value={capModels[cap] || ''} onChange={(e) => setCapModels((prev) => ({ ...prev, [cap]: e.target.value }))}
                placeholder={model || '同默认'}
                className="flex-1 rounded-md border px-2 py-1 text-xs outline-none focus:border-primary" />
            </div>
          ))}
        </div>
      </details>

      {/* Buttons */}
      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing} className="flex-1 rounded-lg border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
          {testing ? '测试中...' : '🔌 测试连通'}
        </button>
        <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? '保存中...' : '💾 保存'}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-md border p-2 text-xs ${testResult.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {testResult.msg}
        </div>
      )}
      {saveMsg && (
        <div className={`rounded-md border p-2 text-xs ${saveMsg.startsWith('✅') ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {saveMsg}
        </div>
      )}
    </div>
  )
}

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
    { key: 'signatures', label: '📝 签名管理' },
  ]

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border px-6 py-3">
        <h1 className="text-lg font-bold text-foreground">⚙️ 设置</h1>
      </header>
      <div className="max-w-3xl space-y-4 px-6 py-6">

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
          <Link href="/settings/accounts" className="mt-2 block rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary/10">
            🧾 管理多个邮箱账号 →
          </Link>
        </div>
      )}

      {/* LLM Settings */}
      {section === 'llm' && (
        <LlmConfigForm />
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

      {/* Signatures Management */}
      {section === 'signatures' && <SignaturesSection />}

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
      </div>
    </main>
  )
}
