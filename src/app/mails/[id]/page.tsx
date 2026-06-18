// src/app/mails/[id]/page.tsx

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { EmailBody } from '@/components/EmailBody'
import { AttachmentList } from '@/components/AttachmentList'
import { emitRefresh } from '@/lib/refresh-bus'

interface AttachmentLite {
  id: number
  contentId: string | null
}

/** 把 bodyHtml 中的 cid:xxx 替换为内联附件 serve URL(渲染时解析内联图片)。 */
function rewriteCidImages(html: string | null, messageId: number, attachments: AttachmentLite[]): string | null {
  if (!html) return html
  const cidMap: Record<string, number> = {}
  for (const a of attachments) {
    if (a.contentId) {
      const stripped = a.contentId.replace(/^<|>$/g, '')
      if (stripped) cidMap[stripped] = a.id
    }
  }
  if (!Object.keys(cidMap).length) return html
  return html.replace(/cid:([^"'\s)>]+)/gi, (m, cid: string) => {
    const aid = cidMap[cid]
    return aid ? `/api/messages/${messageId}/attachments/${aid}?inline=1` : m
  })
}

interface Message {
  id: number
  messageId: string
  subject: string | null
  from: string | null
  to: string | null
  body: string | null
  bodyHtml: string | null
  receivedAt: string | null
  direction: string
  isRead: number
  isStarred: number
  isSpam: number
  isExternal: number
  authResult: string | null
  spamScore: number | null
  todoCount: number
}

interface Todo {
  id: number
  title: string
  dueDate: string | null
  priority: string | null
  status: string
  context: string | null
}

function MailToCalendar({ message }: { message: Message }) {
  const handleConvert = async () => {
    try {
      const r = await fetch('/api/calendar/events/from-mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: message.id }) })
      const d = await r.json()
      if (d.eventDraft) {
        const params = new URLSearchParams()
        params.set('title', d.eventDraft.title)
        params.set('description', d.eventDraft.description || '')
        window.open(`/calendar?${params}`, '_blank')
      }
    } catch { /* ignore */ }
  }
  return <button onClick={handleConvert} className="rounded border px-2 py-0.5 hover:bg-accent">📅 转日程</button>
}

function MailToTodo({ message }: { message: Message }) {
  const handleConvert = async () => {
    await fetch('/api/todos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: (message.subject || '(无主题)').slice(0, 200),
        sourceMessageId: message.messageId,
        sourceSubject: message.subject,
        sourceFrom: message.from,
        status: 'pending',
      }),
    })
    window.location.reload()
  }
  return <button onClick={handleConvert} className="rounded border px-2 py-0.5 hover:bg-accent">✅ 转待办</button>
}

/** AI 增强组件（摘要/智能回复/打标）*/
function AIEnhancements({ message, id }: { message: Message; id: string }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryStyle, setSummaryStyle] = useState<'brief' | 'bullet' | 'normal'>('normal')
  const [suggestions, setSuggestions] = useState<Array<{ text: string; tone: string }>>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [tags, setTags] = useState<{ labels: string[]; priority: string; importance: string } | null>(null)
  const [tagsLoading, setTagsLoading] = useState(false)

  const bodyLen = (message.body?.length || 0) + (message.bodyHtml?.length || 0)

  const handleSummarize = async () => {
    setSummaryLoading(true)
    try {
      const r = await fetch('/api/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: Number(id), style: summaryStyle }) })
      const d = await r.json()
      if (d.summary) setSummary(d.summary)
    } finally { setSummaryLoading(false) }
  }

  const handleSuggestReply = async () => {
    setSuggestionsLoading(true)
    try {
      const r = await fetch('/api/suggest-reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: Number(id) }) })
      const d = await r.json()
      if (d.suggestions) setSuggestions(d.suggestions)
    } finally { setSuggestionsLoading(false) }
  }

  const handleAutoTag = async () => {
    setTagsLoading(true)
    try {
      const r = await fetch('/api/auto-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: Number(id) }) })
      const d = await r.json()
      if (d.labels) setTags(d)
    } finally { setTagsLoading(false) }
  }

  const copyToCompose = (text: string) => {
    const params = new URLSearchParams({ to: message.from || '', subject: message.subject || '', messageId: message.messageId, body: text })
    window.open(`/compose?${params}`, '_blank')
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">🤖 AI 助手</p>
      <div className="flex flex-wrap gap-1.5">
        {/* Summarize */}
        <div className="flex items-center gap-1">
          <select value={summaryStyle} onChange={(e) => setSummaryStyle(e.target.value as any)} className="rounded border px-1.5 py-0.5 text-[10px] bg-background">
            <option value="normal">正常</option>
            <option value="brief">简短</option>
            <option value="bullet">要点</option>
          </select>
          <button onClick={handleSummarize} disabled={summaryLoading} className="rounded border px-2 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
            {summaryLoading ? '⏳' : '📝'} AI 摘要
          </button>
        </div>
        {/* Smart Reply */}
        <button onClick={handleSuggestReply} disabled={suggestionsLoading} className="rounded border px-2 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
          {suggestionsLoading ? '⏳' : '💬'} 智能回复
        </button>
        {/* Auto Tag */}
        <button onClick={handleAutoTag} disabled={tagsLoading} className="rounded border px-2 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
          {tagsLoading ? '⏳' : '🏷️'} 智能打标
        </button>
      </div>

      {/* Summary result */}
      {summary && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <div className="flex items-center justify-between mb-1"><span className="font-medium">摘要</span><button onClick={() => setSummary(null)} className="text-muted-foreground hover:text-foreground">✕</button></div>
          <p className="whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <div className="flex items-center justify-between mb-1"><span className="font-medium">回复建议</span><button onClick={() => setSuggestions([])} className="text-muted-foreground hover:text-foreground">✕</button></div>
          <div className="space-y-1">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1">
                <span>{s.text} <span className="text-[10px] text-muted-foreground">({s.tone})</span></span>
                <button onClick={() => copyToCompose(s.text)} className="text-primary hover:underline whitespace-nowrap">填入</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags result */}
      {tags && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <div className="flex items-center justify-between mb-1"><span className="font-medium">打标建议</span><button onClick={() => setTags(null)} className="text-muted-foreground hover:text-foreground">✕</button></div>
          <div className="flex flex-wrap items-center gap-1">
            {tags.labels.map((l) => <span key={l} className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] text-primary">{l}</span>)}
            <span className="text-[10px] text-muted-foreground">
              {tags.priority === 'high' ? '🔴 紧急' : tags.priority === 'low' ? '🟢 不急' : '🟡 一般'} · {tags.importance === 'important' ? '重要' : '普通'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 发件人旁的"加入通讯录"/"查看名片"按钮 */
function SenderContactButton({ from }: { from: string | null }) {
  const [contacts, setContacts] = useState<{ id: number; name: string; email: string }[]>([])
  const [added, setAdded] = useState(false)

  // 解析 from 获取 email
  const email = from?.match(/<([^>]+)>/)?.[1] || from?.trim() || ''
  const name = from?.replace(/\s*<[^>]+>\s*/, '').trim() || ''
  const isValidEmail = /^[\w.+-]+@[\w.-]+$/.test(email)

  useEffect(() => {
    if (!isValidEmail) return
    fetch(`/api/contacts/autocomplete?q=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => {
        const found = (d.hits || []).filter((h: any) => h.inAddressBook && h.email.toLowerCase() === email.toLowerCase())
        setContacts(found)
      })
      .catch(() => {})
  }, [email, isValidEmail])

  if (!isValidEmail) return null

  const existing = contacts[0]

  const handleAdd = async () => {
    const r = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 1, name: name || email, email }),
    })
    if (r.ok) setAdded(true)
  }

  if (existing) {
    return (
      <Link href={`/contacts/${existing.id}`} className="text-xs text-primary hover:underline">
        📇 {existing.name}
      </Link>
    )
  }

  return (
    <button onClick={handleAdd} disabled={added}
      className="rounded border px-1.5 py-0.5 text-xs transition-colors hover:bg-accent disabled:opacity-50">
      {added ? '✅ 已加入' : '+ 通讯录'}
    </button>
  )
}

export default function MailDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [message, setMessage] = useState<Message | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const [attachments, setAttachments] = useState<AttachmentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMessage = async () => {
      try {
        const res = await fetch(`/api/messages/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setMessage(data.message)
        emitRefresh()

        // 拉附件(列表 + 内联 cid 渲染)
        fetch(`/api/messages/${id}/attachments`)
          .then((r) => r.json())
          .then((d) => setAttachments(d.attachments || []))
          .catch(() => {})

        // 获取关联待办
        const todoRes = await fetch(`/api/todos?status=all`)
        const todoData = await todoRes.json()
        if (todoData.todos) {
          const related = todoData.todos.filter(
            (t: Todo & { sourceMessageId?: string }) =>
              t.sourceMessageId === data.message.messageId
          )
          setTodos(related)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchMessage()
  }, [id])

  const handleToggleStar = async () => {
    if (!message) return
    await fetch(`/api/messages/${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: !message.isStarred }),
    })
    setMessage({ ...message, isStarred: message.isStarred ? 0 : 1 })
  }

  const handleDelete = async () => {
    if (!message) return
    await fetch(`/api/messages/${message.id}`, { method: 'DELETE' })
    router.push('/mails')
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p className="text-center text-muted-foreground">加载中...</p>
      </main>
    )
  }

  if (error || !message) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p className="text-center text-red-500">{error || '邮件不存在'}</p>
        <div className="mt-4 text-center">
          <Link href="/mails" className="text-sm text-primary hover:underline">← 返回邮件列表</Link>
        </div>
      </main>
    )
  }

  const priorityBadge: Record<string, string> = {
    high: '🔴 紧急',
    medium: '🟡 一般',
    low: '🟢 不急',
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-20">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <Link href="/mails" className="text-sm text-primary hover:underline">
          ← 返回邮件列表
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/compose?to=${encodeURIComponent(message.from || '')}&subject=${encodeURIComponent(message.subject || '')}&messageId=${encodeURIComponent(message.messageId)}&originalBody=${encodeURIComponent(message.body || '')}`}
            className="rounded border px-3 py-1 text-xs transition-colors hover:bg-accent"
          >
            ↩ 回复
          </Link>
          <Link
            href={`/compose?forwardMessageId=${encodeURIComponent(message.messageId)}&subject=${encodeURIComponent(message.subject || '')}&originalBody=${encodeURIComponent(message.body || '')}&from=${encodeURIComponent(message.from || '')}&origTo=${encodeURIComponent(message.to || '')}&date=${encodeURIComponent(message.receivedAt || '')}`}
            className="rounded border px-3 py-1 text-xs transition-colors hover:bg-accent"
          >
            ↪ 转发
          </Link>
          <button onClick={handleToggleStar} className="text-lg" title="星标">
            {message.isStarred ? '⭐' : '☆'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded border px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          >
            删除
          </button>
        </div>
      </div>

      {/* Subject */}
      <div>
        <h1 className="text-xl font-bold">{message.subject || '(无主题)'}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>发件人: {message.from || '未知'}</span>
          <SenderContactButton from={message.from} />
          {message.to && <span>收件人: {message.to}</span>}
          <span>{message.receivedAt ? new Date(message.receivedAt).toLocaleString('zh-CN') : ''}</span>
        </div>
      </div>

      {/* 安全横幅 plan-11 Task 10 */}
      {message.authResult && (() => { try { const a = JSON.parse(message.authResult); return (a.spf === 'fail' || a.dkim === 'fail' || a.dmarc === 'fail') ? <div className="rounded border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs text-red-600">⚠️ 认证失败：SPF={a.spf} DKIM={a.dkim} DMARC={a.dmarc}，发件人可能被伪造</div> : null } catch { return null } })()}
      {message.isExternal === 1 && <div className="rounded border border-yellow-400/50 bg-yellow-400/10 px-3 py-1.5 text-xs">⚠️ 这是一封来自组织外部的邮件，请警惕钓鱼/社工</div>}
      {message.isSpam === 1 && <div className="rounded border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs text-red-600">🚫 此邮件已被标记为垃圾（评分 {message.spamScore?.toFixed(1)}）</div>}

      {/* 认证徽标 */}
      {message.authResult && (() => { try { const a = JSON.parse(message.authResult); return <div className="flex gap-2 text-[10px]">{(['spf','dkim','dmarc'] as const).map(k => <span key={k} className={`rounded px-1.5 py-0.5 ${a[k]==='pass'?'bg-green-100 text-green-700':a[k]==='fail'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-500'}`}>{k.toUpperCase()}:{a[k]}</span>)}</div> } catch { return null } })()}
      {message.isSpam === 1 && <div className="flex gap-1"><button onClick={async () => { await fetch(`/api/messages/${message.id}/spam`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unmark' }) }); window.location.reload() }} className="rounded border px-2 py-0.5 text-xs">不是垃圾</button></div>}
      {message.isSpam !== 1 && <div className="flex gap-1"><button onClick={async () => { await fetch(`/api/messages/${message.id}/spam`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark' }) }); window.location.reload() }} className="rounded border px-2 py-0.5 text-xs">标记垃圾</button></div>}

      {/* AI 能力区 */}
      <AIEnhancements message={message} id={id} />

      {/* 转日程 / 转任务 */}
      <div className="flex gap-2 rounded-lg border bg-card/50 p-2 text-xs">
        <MailToCalendar message={message} />
        <MailToTodo message={message} />
      </div>

      {/* Related Todos */}
      {todos.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h3 className="mb-2 text-sm font-medium text-orange-800">
            📋 关联待办 ({todos.length})
          </h3>
          <div className="space-y-1">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-2 text-sm">
                <span>{todo.status === 'done' ? '✅' : '⬜'}</span>
                <span className={todo.status === 'done' ? 'line-through text-muted-foreground' : ''}>
                  {todo.title}
                </span>
                {todo.dueDate && (
                  <span className="text-xs text-orange-600">📅 {todo.dueDate}</span>
                )}
                {todo.priority && (
                  <span className="text-xs">{priorityBadge[todo.priority] || ''}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <EmailBody html={rewriteCidImages(message.bodyHtml, message.id, attachments)} text={message.body} />

      {/* Attachments */}
      <AttachmentList messageId={message.id} />
    </main>
  )
}
