// src/app/contacts/page.tsx — 通讯录列表（名片网格 + 分组侧栏 + 搜索 + 导入导出）
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Suspense } from 'react'

interface Contact { id: number; name: string; email: string; phone: string | null; note: string | null; contactCount: number; lastContactedAt: number | null; groupId: number | null }
interface Group { id: number; name: string; memberCount: number }

function ContactsContent() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [q, setQ] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', note: '', groupId: '' })
  const [importData, setImportData] = useState('')
  const [importFmt, setImportFmt] = useState<'vcard' | 'csv'>('vcard')
  const [importResult, setImportResult] = useState('')

  const fetchContacts = () => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (groupId) params.set('groupId', String(groupId))
    fetch(`/api/contacts?accountId=1&${params}`)
      .then(r => r.json()).then(d => setContacts(d.contacts || [])).catch(() => {})
  }
  const fetchGroups = () => {
    fetch('/api/contacts/groups?accountId=1')
      .then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {})
  }

  useEffect(() => { fetchContacts(); fetchGroups() }, [q, groupId])

  const handleCreate = async () => {
    const r = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 1, ...form, groupId: form.groupId ? Number(form.groupId) : undefined }),
    })
    if (r.ok) { setShowNew(false); setForm({ name: '', email: '', phone: '', note: '', groupId: '' }); fetchContacts() }
  }

  const handleImport = async () => {
    const r = await fetch('/api/contacts/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 1, format: importFmt, data: importData }),
    })
    const d = await r.json()
    setImportResult(`导入 ${d.imported} 条，跳过 ${d.skipped} 条`)
    fetchContacts()
  }

  const exportUrl = `/api/contacts/export?accountId=1&format=`

  return (
    <div className="flex h-full">
      {/* 分组侧栏 */}
      <div className="w-44 shrink-0 border-r border-border bg-card px-3 py-4">
        <h2 className="mb-3 text-sm font-medium">分组</h2>
        <button onClick={() => setGroupId(null)} className={`block w-full rounded px-2 py-1 text-left text-sm ${!groupId ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'}`}>
          全部 ({contacts.length})
        </button>
        {groups.map(g => (
          <button key={g.id} onClick={() => setGroupId(g.id)}
            className={`block w-full rounded px-2 py-1 text-left text-sm ${groupId === g.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'}`}>
            {g.name} ({g.memberCount})
          </button>
        ))}
      </div>

      {/* 主区 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索姓名/邮箱..." className="w-64 rounded border border-border bg-input px-3 py-1.5 text-sm outline-none focus:border-primary" />
          <button onClick={() => setShowNew(true)} className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">+ 新建</button>
          <button onClick={() => setImportData('')} className="rounded border px-3 py-1.5 text-sm">📥 导入</button>
          <a href={exportUrl + 'vcard'} className="rounded border px-3 py-1.5 text-sm">📤 导出 vCard</a>
          <a href={exportUrl + 'csv'} className="rounded border px-3 py-1.5 text-sm">📤 CSV</a>
        </div>

        {/* 导入弹窗 */}
        {importData !== undefined && (
          <div className="mb-4 rounded border border-border bg-card p-4">
            <textarea value={importData} onChange={e => setImportData(e.target.value)} placeholder="粘贴 vCard 或 CSV 内容..." className="mb-2 h-32 w-full rounded border bg-input p-2 text-xs" />
            <select value={importFmt} onChange={e => setImportFmt(e.target.value as any)} className="mr-2 rounded border px-2 py-1 text-xs">
              <option value="vcard">vCard</option><option value="csv">CSV</option>
            </select>
            <button onClick={handleImport} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">导入</button>
            <button onClick={() => setImportData(undefined!)} className="ml-2 rounded border px-2 py-1 text-xs">取消</button>
            {importResult && <span className="ml-2 text-xs text-muted-foreground">{importResult}</span>}
          </div>
        )}

        {/* 新建抽屉 */}
        {showNew && (
          <div className="mb-4 rounded border border-primary/30 bg-card p-4">
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="姓名" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="rounded border bg-input px-2 py-1 text-sm" />
              <input placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="rounded border bg-input px-2 py-1 text-sm" />
              <input placeholder="电话" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="rounded border bg-input px-2 py-1 text-sm" />
              <select value={form.groupId} onChange={e => setForm({...form, groupId: e.target.value})} className="rounded border bg-input px-2 py-1 text-sm">
                <option value="">无分组</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <input placeholder="备注" value={form.note} onChange={e => setForm({...form, note: e.target.value})} className="mt-2 w-full rounded border bg-input px-2 py-1 text-sm" />
            <div className="mt-3 flex gap-2">
              <button onClick={handleCreate} disabled={!form.name || !form.email} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">保存</button>
              <button onClick={() => setShowNew(false)} className="rounded border px-3 py-1 text-sm">取消</button>
            </div>
          </div>
        )}

        {/* 名片列表 */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map(c => (
            <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                <p className="text-[10px] text-muted-foreground">通信 {c.contactCount} 次</p>
              </div>
            </Link>
          ))}
        </div>
        {contacts.length === 0 && <p className="text-center text-sm text-muted-foreground">暂无联系人</p>}
      </div>
    </div>
  )
}

export default function ContactsPage() {
  return <Suspense fallback={<div className="p-6 text-muted-foreground">加载中...</div>}><ContactsContent /></Suspense>
}
