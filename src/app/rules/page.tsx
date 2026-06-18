// src/app/rules/page.tsx — 规则列表 + 编辑器 + 试跑 + Sweep
'use client'

import { useState, useEffect } from 'react'
import { Suspense } from 'react'

interface Rule { id: number; name: string; enabled: boolean; kind: string; order: number; conditions: any; actions: any[] }
interface TestHit { messageId: number; ruleName: string; matched: boolean; actions: any[] }

function RulesContent() {
  const [rules, setRules] = useState<Rule[]>([])
  const [editing, setEditing] = useState<Rule | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', kind: 'normal', enabled: true, combinator: 'and' as 'and'|'or', conditionRows: [{ field: 'from', operator: 'contains', value: '' }] as any[], actionRows: [{ type: 'markRead' }] as any[] })
  const [testResult, setTestResult] = useState<{ total: number; matched: TestHit[] } | null>(null)
  const [sweepEmail, setSweepEmail] = useState('')
  const [sweepResult, setSweepResult] = useState('')
  const [wlEmail, setWlEmail] = useState('')
  const [blEmail, setBlEmail] = useState('')

  const fetchRules = () => fetch('/api/rules?accountId=1').then(r => r.json()).then(d => setRules(d.rules || []))

  useEffect(() => { fetchRules() }, [])

  const saveRule = async () => {
    const body = {
      accountId: 1, name: form.name, kind: form.kind, enabled: form.enabled,
      conditions: { combinator: form.combinator, conditions: form.conditionRows },
      actions: form.actionRows.map((a: any) => {
        const act: any = { type: a.type }
        if (a.type === 'move') act.targetFolder = a.targetFolder
        if (a.type === 'label' || a.type === 'unlabel') act.labelIds = (a.labelIds || '').split(',').map(Number).filter(Boolean)
        if (a.type === 'forward') act.forwardTo = a.forwardTo
        if (a.type === 'priority') act.priority = a.priority
        return act
      }),
    }
    const url = editing ? `/api/rules/${editing.id}` : '/api/rules'
    const method = editing ? 'PATCH' : 'POST'
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) { setShowNew(false); setEditing(null); fetchRules() }
  }

  const testRule = async () => {
    const body = { accountId: 1, conditions: { combinator: form.combinator, conditions: form.conditionRows }, actions: form.actionRows }
    const r = await fetch('/api/rules/0/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setTestResult(await r.json())
  }

  const doSweep = async () => {
    const r = await fetch('/api/rules/sweep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 1, fromEmail: sweepEmail }) })
    const d = await r.json()
    setSweepResult(`归档 ${d.archivedCount} 封，保留最新 #${d.keptMessageId}`)
    fetchRules()
  }

  const toggleEnabled = async (r: Rule) => {
    await fetch(`/api/rules/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !r.enabled }) })
    fetchRules()
  }

  const delRule = async (id: number) => { if (!confirm('删除？')) return; await fetch(`/api/rules/${id}`, { method: 'DELETE' }); fetchRules() }

  const addToList = async (kind: 'whitelist'|'blacklist', email: string) => {
    await fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 1, name: `${kind === 'whitelist' ? '白名单' : '黑名单'}: ${email}`, conditions: { combinator: 'and', conditions: [{ field: 'from', operator: 'contains', value: email }] }, actions: kind === 'blacklist' ? [{ type: 'delete' }] : [], kind }) })
    fetchRules()
  }

  const openEdit = (r: Rule) => {
    setEditing(r)
    setForm({ name: r.name, kind: r.kind, enabled: r.enabled, combinator: r.conditions.combinator, conditionRows: r.conditions.conditions, actionRows: r.actions })
    setShowNew(true)
  }

  const resetForm = () => { setForm({ name: '', kind: 'normal', enabled: true, combinator: 'and', conditionRows: [{ field: 'from', operator: 'contains', value: '' }], actionRows: [{ type: 'markRead' }] }); setEditing(null); setShowNew(true) }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-lg font-bold">规则与过滤器</h1>

      {/* 白/黑名单快捷入口 */}
      <div className="mb-4 flex gap-2">
        <div className="flex items-center gap-1">
          <input value={wlEmail} onChange={e => setWlEmail(e.target.value)} placeholder="白名单 email" className="w-40 rounded border px-2 py-1 text-xs" />
          <button onClick={() => { addToList('whitelist', wlEmail); setWlEmail('') }} className="rounded bg-green-500 px-2 py-1 text-xs text-white">+ 白名单</button>
        </div>
        <div className="flex items-center gap-1">
          <input value={blEmail} onChange={e => setBlEmail(e.target.value)} placeholder="黑名单 email" className="w-40 rounded border px-2 py-1 text-xs" />
          <button onClick={() => { addToList('blacklist', blEmail); setBlEmail('') }} className="rounded bg-red-500 px-2 py-1 text-xs text-white">+ 黑名单</button>
        </div>
        <button onClick={resetForm} className="ml-auto rounded bg-primary px-3 py-1 text-sm text-primary-foreground">+ 新建规则</button>
      </div>

      {/* Inbox Sweep */}
      <div className="mb-4 flex items-center gap-2 rounded border bg-card p-2">
        <span className="text-xs">🧹 Sweep: 归档</span>
        <input value={sweepEmail} onChange={e => setSweepEmail(e.target.value)} placeholder="发件人 email" className="w-40 rounded border px-2 py-1 text-xs" />
        <button onClick={doSweep} className="rounded bg-orange-500 px-2 py-1 text-xs text-white">执行</button>
        {sweepResult && <span className="text-xs text-muted-foreground">{sweepResult}</span>}
      </div>

      {/* 规则编辑器 */}
      {showNew && (
        <div className="mb-4 rounded border border-primary/30 bg-card p-4">
          <div className="mb-3 flex gap-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="规则名称" className="flex-1 rounded border px-2 py-1 text-sm" />
            <select value={form.kind} onChange={e => setForm({...form, kind: e.target.value})} className="rounded border px-2 py-1 text-sm">
              <option value="normal">普通</option><option value="whitelist">白名单</option><option value="blacklist">黑名单</option>
            </select>
          </div>
          {/* 条件 */}
          <p className="mb-1 text-xs text-muted-foreground">匹配条件</p>
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => setForm({...form, combinator: 'and'})} className={`rounded px-2 py-0.5 text-xs ${form.combinator==='and'?'bg-primary text-primary-foreground':'border'}`}>AND</button>
            <button onClick={() => setForm({...form, combinator: 'or'})} className={`rounded px-2 py-0.5 text-xs ${form.combinator==='or'?'bg-primary text-primary-foreground':'border'}`}>OR</button>
          </div>
          {form.conditionRows.map((c, i) => (
            <div key={i} className="mb-1 flex gap-1">
              <select value={c.field} onChange={e => { const n = [...form.conditionRows]; n[i] = {...n[i], field: e.target.value}; setForm({...form, conditionRows: n}) }} className="rounded border px-1 py-0.5 text-xs">
                <option value="from">发件人</option><option value="to">收件人</option><option value="cc">抄送</option>
                <option value="subject">主题</option><option value="body">正文</option><option value="hasAttachment">有附件</option>
                <option value="size">大小(KB)</option><option value="label">标签</option>
              </select>
              <select value={c.operator} onChange={e => { const n = [...form.conditionRows]; n[i] = {...n[i], operator: e.target.value}; setForm({...form, conditionRows: n}) }} className="rounded border px-1 py-0.5 text-xs">
                <option value="contains">包含</option><option value="notContains">不包含</option><option value="equals">等于</option>
                <option value="startsWith">开头是</option><option value="endsWith">结尾是</option><option value="matchesRegex">正则</option>
                {c.field==='size' && <><option value="gt">&gt;</option><option value="lt">&lt;</option></>}
              </select>
              <input value={String(c.value)} onChange={e => { const n = [...form.conditionRows]; n[i] = {...n[i], value: e.target.value}; setForm({...form, conditionRows: n}) }} placeholder="值" className="flex-1 rounded border px-1 py-0.5 text-xs" />
              <button onClick={() => { const n = form.conditionRows.filter((_,j) => j!==i); setForm({...form, conditionRows: n.length?n:[{ field: 'from', operator: 'contains', value: '' }]}) }} className="text-xs text-red-500">×</button>
            </div>
          ))}
          <button onClick={() => setForm({...form, conditionRows: [...form.conditionRows, { field: 'from', operator: 'contains', value: '' }]})} className="text-xs text-primary">+ 条件</button>

          {/* 动作 */}
          <p className="mb-1 mt-3 text-xs text-muted-foreground">执行动作</p>
          {form.actionRows.map((a, i) => (
            <div key={i} className="mb-1 flex gap-1 flex-wrap">
              <select value={a.type} onChange={e => { const n = [...form.actionRows]; n[i] = { type: e.target.value }; setForm({...form, actionRows: n}) }} className="rounded border px-1 py-0.5 text-xs">
                <option value="markRead">标已读</option><option value="markUnread">标未读</option>
                <option value="star">标星</option><option value="move">移动</option>
                <option value="delete">删除</option><option value="label">贴标签</option>
                <option value="unlabel">撕标签</option><option value="forward">转发</option>
                <option value="priority">设优先级</option><option value="toTodo">转待办</option>
              </select>
              {a.type === 'move' && <input value={a.targetFolder||''} onChange={e => { const n=[...form.actionRows]; n[i]={...n[i], targetFolder: e.target.value}; setForm({...form, actionRows:n}) }} placeholder="目标文件夹" className="rounded border px-1 py-0.5 text-xs w-24" />}
              {(a.type==='label'||a.type==='unlabel') && <input value={a.labelIds||''} onChange={e => { const n=[...form.actionRows]; n[i]={...n[i], labelIds: e.target.value}; setForm({...form, actionRows:n}) }} placeholder="label id(逗号分隔)" className="rounded border px-1 py-0.5 text-xs w-32" />}
              {a.type === 'forward' && <input value={a.forwardTo||''} onChange={e => { const n=[...form.actionRows]; n[i]={...n[i], forwardTo: e.target.value}; setForm({...form, actionRows:n}) }} placeholder="转发到" className="rounded border px-1 py-0.5 text-xs w-40" />}
              {a.type === 'priority' && <select value={a.priority||'normal'} onChange={e => { const n=[...form.actionRows]; n[i]={...n[i], priority: e.target.value}; setForm({...form, actionRows:n}) }} className="rounded border px-1 py-0.5 text-xs"><option value="high">紧急</option><option value="normal">普通</option><option value="low">不急</option></select>}
              <button onClick={() => { const n = form.actionRows.filter((_,j) => j!==i); setForm({...form, actionRows: n.length?n:[{ type: 'markRead' }]}) }} className="text-xs text-red-500">×</button>
            </div>
          ))}
          <button onClick={() => setForm({...form, actionRows: [...form.actionRows, { type: 'markRead' }]})} className="text-xs text-primary">+ 动作</button>

          <div className="mt-3 flex gap-2">
            <button onClick={saveRule} disabled={!form.name} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">{editing ? '保存' : '创建'}</button>
            <button onClick={testRule} className="rounded border px-3 py-1 text-sm">🔍 试跑</button>
            <button onClick={() => { setShowNew(false); setEditing(null) }} className="rounded border px-3 py-1 text-sm">取消</button>
          </div>
        </div>
      )}

      {/* 试跑结果 */}
      {testResult && (
        <div className="mb-4 rounded border bg-card p-4">
          <p className="mb-2 text-sm font-medium">试跑结果：扫描 {testResult.total} 封，命中 {testResult.matched.length} 封</p>
          {testResult.matched.map((m, i) => <div key={i} className="text-xs text-muted-foreground">#{m.messageId}: {m.actions.map((a: any) => a.type).join(', ')}</div>)}
          <button onClick={() => setTestResult(null)} className="mt-2 text-xs text-primary">关闭</button>
        </div>
      )}

      {/* 规则列表 */}
      <div className="space-y-1">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded border bg-card px-3 py-2">
            <span className={`h-2 w-2 rounded-full ${r.kind==='whitelist'?'bg-green-500':r.kind==='blacklist'?'bg-red-500':'bg-blue-500'}`} />
            <span className="flex-1 text-sm">{r.name}</span>
            <span className="text-[10px] text-muted-foreground">{r.kind}</span>
            <button onClick={() => toggleEnabled(r)} className={`rounded px-1.5 py-0.5 text-[10px] ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
              {r.enabled ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => openEdit(r)} className="text-xs">✏️</button>
            <button onClick={() => delRule(r.id)} className="text-xs text-red-500">🗑</button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted-foreground">暂无规则</p>}
      </div>
    </div>
  )
}

export default function RulesPage() {
  return <Suspense fallback={<div className="p-6 text-muted-foreground">加载中...</div>}><RulesContent /></Suspense>
}
