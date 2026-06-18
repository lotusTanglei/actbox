// src/components/search/SavedSearches.tsx
// 侧栏常驻 Saved Search:点击跳 /search?q=,删除(×),+ 新建(基于当前 q)。plan-07 Task 8。

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface SavedSearch {
  id: string
  name: string
  query: string
}

export function SavedSearches() {
  const router = useRouter()
  const params = useSearchParams()
  const [list, setList] = useState<SavedSearch[]>([])

  const load = () =>
    fetch('/api/search/saved')
      .then((r) => r.json())
      .then((d) => setList(d.searches || []))
      .catch(() => {})

  useEffect(() => {
    load()
  }, [])

  const remove = async (id: string) => {
    await fetch(`/api/search/saved/${id}`, { method: 'DELETE' })
    setList((prev) => prev.filter((s) => s.id !== id))
  }

  const create = async () => {
    const q = params.get('q')
    if (!q) return
    const name = window.prompt('保存为', q.slice(0, 20))
    if (!name) return
    await fetch('/api/search/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, query: q }),
    })
    load()
  }

  if (list.length === 0 && !params.get('q')) return null

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">已保存搜索</span>
        {params.get('q') && (
          <button type="button" onClick={create} className="text-[10px] text-primary hover:underline" title="保存当前搜索">
            + 保存
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {list.map((s) => (
          <div key={s.id} className="group flex items-center">
            <Link
              href={`/search?q=${encodeURIComponent(s.query)}`}
              className="flex-1 truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              title={s.query}
            >
              🔖 {s.name}
            </Link>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="ml-1 hidden rounded px-1 text-xs text-muted-foreground hover:text-red-500 group-hover:block"
              title="删除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
