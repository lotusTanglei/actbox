// src/components/search/SearchBar.tsx
// 顶部搜索框:输入联想(历史 + 操作符补全),回车跳 /search?q=。plan-07 Task 8。

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SearchSuggest } from '@/components/search/SearchSuggest'

const OPERATORS = ['from:', 'to:', 'subject:', 'has:attachment', 'after:', 'before:', 'is:unread', 'is:starred']

export function SearchBar() {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const [history, setHistory] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setValue(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    fetch('/api/search/history')
      .then((r) => r.json())
      .then((d) => setHistory((d.history || []).map((h: { query: string }) => h.query)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const submit = (q: string) => {
    const trimmed = q.trim()
    setOpen(false)
    if (trimmed) router.push(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  const historyHits = value.trim()
    ? history.filter((h) => h.toLowerCase().includes(value.toLowerCase())).slice(0, 5)
    : history.slice(0, 5)
  const opHits = OPERATORS.filter((o) => o.toLowerCase().startsWith(value.toLowerCase().trim())).slice(0, 4)

  const handlePick = (picked: string) => {
    // 操作符 → 补全到输入框；历史条目 → 直接搜索
    if (OPERATORS.includes(picked)) {
      setValue((v) => (v.trim() ? `${v.replace(/[^:\s]+$/, '')}${picked}` : picked))
    } else {
      submit(picked)
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit(value)
        }}
        placeholder="搜索邮件… from: to: subject: has:attachment after: is:unread"
        className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      {open && (
        <SearchSuggest
          historyItems={historyHits}
          operatorHints={opHits}
          onPick={handlePick}
        />
      )}
    </div>
  )
}
