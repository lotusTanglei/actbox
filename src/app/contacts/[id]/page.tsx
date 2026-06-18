// src/app/contacts/[id]/page.tsx — 联系人详情（名片 + 往来邮件）
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Suspense } from 'react'

interface Contact { id: number; name: string; email: string; phone: string | null; note: string | null; contactCount: number; lastContactedAt: number | null; groupId: number | null; groupName?: string | null }
interface Message { id: number; subject: string | null; from: string | null; direction: string; receivedAt: string | null }

function ContactDetail() {
  const { id } = useParams<{ id: string }>()
  const [contact, setContact] = useState<Contact | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', note: '' })

  useEffect(() => {
    fetch(`/api/contacts/${id}`).then(r => r.json()).then(d => {
      if (d.contact) { setContact(d.contact); setForm({ name: d.contact.name, email: d.contact.email, phone: d.contact.phone || '', note: d.contact.note || '' }) }
    })
  }, [id])

  useEffect(() => {
    if (!contact) return
    fetch(`/api/messages?q=${encodeURIComponent(contact.email)}`).then(r => r.json()).then(d => setMessages(d.messages || []))
  }, [contact])

  const handleSave = async () => {
    const r = await fetch(`/api/contacts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (r.ok) { setEditing(false); const d = await r.json(); setContact(d.contact) }
  }

  const handleDelete = async () => {
    if (!confirm('确定删除？')) return
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
    window.location.href = '/contacts'
  }

  if (!contact) return <div className="p-6 text-muted-foreground">加载中...</div>

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href="/contacts" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">← 通讯录</Link>
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 text-2xl font-bold text-primary">
            {contact.name.charAt(0)}
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="space-y-2">
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full rounded border bg-input px-2 py-1 text-sm" placeholder="姓名" />
                <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full rounded border bg-input px-2 py-1 text-sm" placeholder="Email" />
                <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full rounded border bg-input px-2 py-1 text-sm" placeholder="电话" />
                <input value={form.note} onChange={e => setForm({...form, note: e.target.value})} className="w-full rounded border bg-input px-2 py-1 text-sm" placeholder="备注" />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">保存</button>
                  <button onClick={() => setEditing(false)} className="rounded border px-3 py-1 text-sm">取消</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold">{contact.name}</h1>
                <p className="text-sm text-muted-foreground">{contact.email}</p>
                {contact.phone && <p className="text-sm">📞 {contact.phone}</p>}
                {contact.groupName && <p className="text-sm">📁 {contact.groupName}</p>}
                {contact.note && <p className="text-sm text-muted-foreground">{contact.note}</p>}
                <p className="mt-1 text-xs text-muted-foreground">通信 {contact.contactCount} 次</p>
                <div className="mt-3 flex gap-2">
                  <Link href={`/compose?to=${encodeURIComponent(contact.email)}`} className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">✉️ 发邮件</Link>
                  <button onClick={() => setEditing(true)} className="rounded border px-3 py-1.5 text-sm">✏️ 编辑</button>
                  <button onClick={handleDelete} className="rounded border border-destructive px-3 py-1.5 text-sm text-destructive">🗑 删除</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 往来邮件 */}
      <h2 className="mb-3 mt-6 text-sm font-medium">往来邮件 ({messages.length})</h2>
      <div className="space-y-1">
        {messages.map(m => (
          <Link key={m.id} href={`/mails/${m.id}`} className="flex items-center justify-between rounded border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/30">
            <span className="truncate text-sm">{m.subject || '(无主题)'}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{m.direction === 'in' ? '📥' : '📤'} {m.receivedAt ? new Date(m.receivedAt).toLocaleDateString('zh-CN') : ''}</span>
          </Link>
        ))}
        {messages.length === 0 && <p className="text-sm text-muted-foreground">暂无往来邮件</p>}
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={<div className="p-6 text-muted-foreground">加载中...</div>}><ContactDetail /></Suspense>
}
