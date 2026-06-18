// src/components/RecipientFields.tsx
// To/Cc/Bcc 三栏收件人输入:Cc/Bcc 默认折叠;实时校验非法地址标红;外部域黄色提醒。plan-05 Task 8。

'use client'

import { useState } from 'react'
import {
  splitAddresses,
  validateRecipients,
  findExternalDomains,
} from '@/lib/mail/recipients'

interface RecipientFieldsProps {
  to: string
  cc: string
  bcc: string
  onTo: (v: string) => void
  onCc: (v: string) => void
  onBcc: (v: string) => void
  /** 账号自有域(用于外部域提醒);不传则不提醒 */
  ownDomains?: string[]
}

function Field({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  invalid: string[]
}) {
  const hasInvalid = invalid.length > 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label === '收件人' ? 'a@x.com, b@y.com' : ''}
        className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary ${
          hasInvalid ? 'border-red-500' : ''
        }`}
      />
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

  const external =
    ownDomains && ownDomains.length
      ? findExternalDomains([...splitAddresses(to), ...splitAddresses(cc), ...splitAddresses(bcc)], ownDomains)
      : []

  return (
    <div className="space-y-2">
      <Field label="收件人" value={to} onChange={onTo} invalid={toInvalid} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {!showCc && (
          <button type="button" onClick={() => setShowCc(true)} className="hover:text-foreground">
            + 抄送
          </button>
        )}
        {!showBcc && (
          <button type="button" onClick={() => setShowBcc(true)} className="hover:text-foreground">
            + 密送
          </button>
        )}
      </div>
      {showCc && <Field label="抄送" value={cc} onChange={onCc} invalid={ccInvalid} />}
      {showBcc && <Field label="密送" value={bcc} onChange={onBcc} invalid={bccInvalid} />}

      {external.length > 0 && (
        <div className="rounded-md border border-yellow-400/50 bg-yellow-400/10 px-3 py-1.5 text-xs text-yellow-300">
          ⚠️ 收件人来自外部域: {external.join(', ')}
        </div>
      )}
    </div>
  )
}
