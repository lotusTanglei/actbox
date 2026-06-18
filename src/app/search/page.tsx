// src/app/search/page.tsx
// 搜索结果页:FTS5 命中列表 + 排序(时间/相关性/发件人)+ 账号/文件夹二次过滤 + 高亮。plan-07 Task 8。

'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Hit {
  id: number
  messageId: string
  subject: string | null
  sender: string | null
  receivedAt: number | null
  isRead: number
  isStarred: number
  accountId: number | null
  folder: string | null
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text) return null
  const parts = [text]
  for (const term of terms) {
    if (!term) continue
    const next: string[] = []
    for (const p of parts) {
      const idx = p.toLowerCase().indexOf(term.toLowerCase())
      if (idx >= 0) {
        next.push(p.slice(0, idx))
        next.push(p.slice(idx, idx + term.length))
        next.push(p.slice(idx + term.length))
      } else next.push(p)
    }
    parts.splice(0, parts.length, ...next)
  }
  // 标记命中 term 的片段
  const lower = parts.map((p) => p.toLowerCase())
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t && p.toLowerCase() === t.toLowerCase().slice(0, p.length) && p) ? (
          <mark key={i} className="rounded bg-yellow-400/40 px-0.5">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function SearchContent() {
  const params = useSearchParams()
  const router = useRouter()
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? 'relevance'
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q) {
      setHits([])
      return
    }
    setLoading(true)
    fetch(`/api/messages?q=${encodeURIComponent(q)}&sort=${sort}`)
      .then((r) => r.json())
      .then((d) => setHits(d.messages || []))
      .catch(() => setHits([]))
      .finally(() => setLoading(false))
    // 记录搜索历史
    fetch('/api/search/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    }).catch(() => {})
  }, [q, sort])

  const setSort = (s: string) => {
    router.push(`/search?q=${encodeURIComponent(q)}&sort=${s}`)
  }

  const terms = q.split(/\s+/).filter((t) => t && !t.includes(':'))

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">
          搜索: <span className="text-primary">{q}</span>
        </h1>
        <Link href="/mails" className="text-sm text-primary hover:underline">
          ← 返回邮件
        </Link>
      </div>

      <div className="flex gap-2 text-xs">
        {(['relevance', 'time', 'sender'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`rounded-md border px-2 py-1 transition-colors ${
              sort === s ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {s === 'relevance' ? '相关性' : s === 'time' ? '时间' : '发件人'}
          </button>
        ))}
      </div>

      {loading && <p className="text-center text-sm text-muted-foreground">搜索中...</p>}
      {!loading && q && hits.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">无结果。试试 from: / subject: 操作符。</p>
      )}

      <ul className="space-y-1">
        {hits.map((h) => (
          <li key={h.id}>
            <Link
              href={`/mails/${h.id}`}
              className="block rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`flex-1 truncate text-sm ${h.isRead ? 'font-normal text-foreground' : 'font-semibold text-foreground'}`}>
                  <Highlight text={h.subject || '(无主题)'} terms={terms} />
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {h.receivedAt ? new Date(h.receivedAt * 1000).toLocaleDateString('zh-CN') : ''}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{h.sender || '未知'}</span>
                {h.folder && (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {h.accountId ? `#${h.accountId} ` : ''}
                    {h.folder}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-muted-foreground">加载中...</div>}>
      <SearchContent />
    </Suspense>
  )
}
