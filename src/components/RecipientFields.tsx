// src/components/RecipientFields.tsx
// To/Cc/Bcc + 收件人自动补全（通讯录 ∪ 历史通信）。plan-05 Task 8 + plan-09 Task 9。

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { splitAddresses, validateRecipients, findExternalDomains } from '@/lib/mail/recipients'

interface RecipientFieldsProps {
  to: string; cc: string; bcc: string
  onTo: (v: string) => void; onCc: (v: string) => void; onBcc: (v: string) => void
  ownDomains?: string[]
}

interface AutocompleteHit { name: string; email: string; source: string }

function FieldWithSuggest({
  label, value, onChange, invalid,
}: {
  label: string; value: string; onChange: (v: string) => void; invalid: string[]
}) {
  const hasInvalid = invalid.length > 0
  const [hits, setHits] = useState<AutocompleteHit[]>([])
  const [show, setShow] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<NodeJS.Timeout>(undefined)

  // 获取当前光标所在的 token（逗号分隔的最后一段）
  const getCurrentToken = useCallback(() => {
    const parts = value.split(',')
    return (parts[parts.length - 1] || '').trim()
  }, [value])

  const fetchHits = useCallback((q: string) => {
    if (!q || q.length < 1) { setHits([]); setShow(false); return }
    fetch(`/api/contacts/autocomplete?q=${encodeURIComponent(q)}&accountId=1`)
      .then(r => r.json()).then(d => { setHits(d.hits || []); setShow(true); setActiveIdx(-1) })
      .catch(() => {})
  }, [])

  const handleChange = (v: string) => {
    onChange(v)
    clearTimeout(timer.current)
    const token = getCurrentToken()
    // debounce 150ms
    timer.current = setTimeout(() => fetchHits(token), 150)
  }

  const applySuggestion = (hit: AutocompleteHit) => {
    const parts = value.split(',')
    parts.pop()
    const newVal = [...parts, ` ${hit.name} <${hit.email}>`].join(',').trim()
    onChange(newVal.endsWith(',') ? newVal : newVal + ', ')
    setShow(false)
  }

  // 点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShow(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="relative flex-1">
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (!show || hits.length === 0) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % hits.length) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + hits.length) % hits.length) }
            else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (activeIdx >= 0 && hits[activeIdx]) applySuggestion(hits[activeIdx]) }
            else if (e.key === 'Escape') setShow(false)
          }}
          placeholder={label === '收件人' ? 'a@x.com, b@y.com' : ''}
          className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary ${hasInvalid ? 'border-red-500' : ''}`}
        />
        {show && hits.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-border bg-popover shadow-lg">
            {hits.map((h, i) => (
              <div key={h.email}
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(h) }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer ${i === activeIdx ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <span>{h.name} &lt;{h.email}&gt;</span>
                <span className="text-[10px] text-muted-foreground">{h.source === 'addressbook' ? '📇' : h.source === 'both' ? '📇📧' : '📧'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {hasInvalid && <span className="shrink-0 text-xs text-red-500">非法地址</span>}
    </div>
  )
}

export function RecipientFields({ to, cc, bcc, onTo, onCc, onBcc, ownDomains }: RecipientFieldsProps) {
  const [showCc, setShowCc] = useState(!!cc)
  const [showBcc, setShowBcc] = useState(!!bcc)

  const toInvalid = validateRecipients(splitAddresses(to)).invalid
  const ccInvalid = validateRecipients(splitAddresses(cc)).invalid
  const bccInvalid = validateRecipients(splitAddresses(bcc)).invalid

  const external = ownDomains?.length
    ? findExternalDomains([...splitAddresses(to), ...splitAddresses(cc), ...splitAddresses(bcc)], ownDomains)
    : []

  return (
    <div className="space-y-2">
      <FieldWithSuggest label="收件人" value={to} onChange={onTo} invalid={toInvalid} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {!showCc && <button type="button" onClick={() => setShowCc(true)} className="hover:text-foreground">+ 抄送</button>}
        {!showBcc && <button type="button" onClick={() => setShowBcc(true)} className="hover:text-foreground">+ 密送</button>}
      </div>
      {showCc && <FieldWithSuggest label="抄送" value={cc} onChange={onCc} invalid={ccInvalid} />}
      {showBcc && <FieldWithSuggest label="密送" value={bcc} onChange={onBcc} invalid={bccInvalid} />}
      {external.length > 0 && (
        <div className="rounded-md border border-yellow-400/50 bg-yellow-400/10 px-3 py-1.5 text-xs text-yellow-300">
          ⚠️ 收件人来自外部域: {external.join(', ')}
        </div>
      )}
    </div>
  )
}
