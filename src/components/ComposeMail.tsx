// src/components/ComposeMail.tsx

'use client'

import { useEffect, useRef, useState } from 'react'
import { htmlToText } from 'html-to-text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RichTextEditor } from '@/components/RichTextEditor'
import { RecipientFields } from '@/components/RecipientFields'
import { detectAttachmentMention } from '@/lib/mail/recipients'
import { buildForward } from '@/lib/mail/forward'

/** 上传端点返回的待发附件元数据 */
export interface PendingAttachment {
  key: string
  filename: string
  size: number
  mimeType: string
  storagePath: string
  cid?: string
  isInline: boolean
}

interface ComposeMailProps {
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  initialBody?: string
  replyToMessageId?: string
  originalBody?: string
  originalSubject?: string
  originalFrom?: string
  originalTo?: string
  originalDate?: string
  todoContext?: string
  /** 转发:源邮件 messageId(带则进入转发模式) */
  forwardOfMessageId?: string
  accountId?: number
  onDone?: () => void
  onCancel?: () => void
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(mime: string): string {
  if (mime.startsWith('image/')) return '🖼'
  if (mime === 'application/pdf') return '📄'
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜'
  if (mime.startsWith('text/')) return '📝'
  return '📎'
}

export function ComposeMail({
  to: initialTo = '',
  cc: initialCc = '',
  bcc: initialBcc = '',
  subject: initialSubject = '',
  initialBody = '',
  replyToMessageId,
  originalBody,
  originalSubject,
  originalFrom,
  originalTo,
  originalDate,
  todoContext,
  forwardOfMessageId,
  accountId: propAccountId,
  onDone,
  onCancel,
}: ComposeMailProps) {
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState(initialCc)
  const [bcc, setBcc] = useState(initialBcc)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [activeAccountId, setActiveAccountId] = useState<number | null>(propAccountId ?? null)
  const [ownDomains, setOwnDomains] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const keySeq = useRef(0)
  const draftIdRef = useRef<number | null>(null)
  const initedRef = useRef(false)

  // 当前字段快照(供 debounced 自动保存闭包读取,避免 stale)
  const fieldsRef = useRef({ to, cc, bcc, subject })
  fieldsRef.current = { to, cc, bcc, subject }

  const plainBody = htmlToText(body).trim()
  const mentionMissingAttachment = detectAttachmentMention(plainBody, attachments)

  // 初始化:签名注入 / 转发预填(各仅一次)
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    ;(async () => {
      // 转发模式:buildForward 预填
      if (forwardOfMessageId && originalBody) {
        const fwd = buildForward(
          {
            messageId: forwardOfMessageId,
            subject: originalSubject || '',
            from: originalFrom || '',
            to: originalTo || '',
            body: originalBody,
            receivedAt: originalDate ? new Date(originalDate) : null,
          },
          { accountId: activeAccountId ?? 1 },
        )
        setBody(plainTextToHtml(fwd.body))
        setSubject(fwd.subject)
        return
      }
      // 空新邮件:注入签名(账号专用优先,回落全局)
      if (!initialBody) {
        try {
          const accId = activeAccountId ?? (await firstActiveAccountId())
          if (accId != null) {
            setActiveAccountId(accId)
            const sig = await fetchSignature(accId)
            if (sig) setBody(sig)
          }
        } catch {
          /* ignore */
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拉账号自有域(外部域提醒)+ 默认 accountId
  useEffect(() => {
    if (activeAccountId != null) return
    ;(async () => {
      const id = await firstActiveAccountId()
      if (id) {
        setActiveAccountId(id)
        const email = await firstActiveEmail()
        const domain = email?.split('@')[1]
        if (domain) setOwnDomains([domain])
      }
    })()
  }, [activeAccountId])

  async function firstActiveAccountId(): Promise<number | null> {
    const r = await fetch('/api/accounts')
    const d = await r.json()
    const active = (d.accounts || []).find((a: { isActive: boolean }) => a.isActive)
    return active?.id ?? d.accounts?.[0]?.id ?? null
  }
  async function firstActiveEmail(): Promise<string | null> {
    const r = await fetch('/api/accounts')
    const d = await r.json()
    const active = (d.accounts || []).find((a: { isActive: boolean }) => a.isActive)
    return active?.email ?? d.accounts?.[0]?.email ?? null
  }
  async function fetchSignature(accId: number): Promise<string> {
    const r = await fetch('/api/settings')
    const d = await r.json()
    return d.settings?.[`signature:${accId}`] || d.settings?.signature || ''
  }

  const uploadFile = async (file: File, inline = false): Promise<PendingAttachment> => {
    const form = new FormData()
    form.append('file', file)
    if (inline) form.append('inline', '1')
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '上传失败')
    return {
      key: `att-${keySeq.current++}`,
      filename: data.filename,
      size: data.size,
      mimeType: data.mimeType,
      storagePath: data.storagePath,
      cid: data.cid,
      isInline: inline,
    }
  }

  const addFiles = async (files: FileList | File[], inline = false) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setUploading(true)
    setMessage(null)
    try {
      const uploaded = await Promise.all(arr.map((f) => uploadFile(f, inline)))
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : '上传失败'}`)
    } finally {
      setUploading(false)
    }
  }

  const handleInlineImage = async (file: File) => {
    setUploading(true)
    try {
      const att = await uploadFile(file, true)
      setAttachments((prev) => [...prev, att])
      return att.cid
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : '图片上传失败'}`)
      return undefined
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = (key: string) => setAttachments((prev) => prev.filter((a) => a.key !== key))

  // debounced 自动保存到草稿
  const autosave = async (html: string) => {
    const f = fieldsRef.current
    const plain = htmlToText(html).trim()
    try {
      if (draftIdRef.current == null) {
        const res = await fetch('/api/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: activeAccountId ?? undefined,
            to: f.to,
            cc: f.cc,
            bcc: f.bcc,
            subject: f.subject,
            body: plain,
            bodyHtml: html,
          }),
        })
        const data = await res.json()
        if (res.ok) draftIdRef.current = data.id
      } else {
        await fetch(`/api/draft/${draftIdRef.current}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: f.to, cc: f.cc, bcc: f.bcc, subject: f.subject, body: plain, bodyHtml: html }),
        })
      }
    } catch {
      /* 自动保存失败静默 */
    }
  }

  const handleSend = async () => {
    if (!to || !subject || !plainBody) return
    setSending(true)
    setMessage(null)
    try {
      const payload = attachments.map((a) => ({
        filename: a.filename,
        storagePath: a.isInline ? undefined : a.storagePath,
        cid: a.cid,
      }))
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          cc,
          bcc,
          subject,
          body: plainBody,
          bodyHtml: body,
          replyToMessageId,
          forwardOfMessageId,
          accountId: activeAccountId ?? undefined,
          attachments: payload,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // 发送成功删除草稿(若有)
      if (draftIdRef.current != null) {
        await fetch(`/api/draft/${draftIdRef.current}`, { method: 'DELETE' }).catch(() => {})
      }
      setMessage('✅ 邮件已发送')
      onDone?.()
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : '发送失败'}`)
    } finally {
      setSending(false)
    }
  }

  const handleDraft = async () => {
    setDrafting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: activeAccountId ?? undefined, to, cc, bcc, subject, body: plainBody, bodyHtml: body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      draftIdRef.current = data.id
      setMessage('💾 草稿已保存')
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : '保存失败'}`)
    } finally {
      setDrafting(false)
    }
  }

  const handleAiDraft = async () => {
    if (!originalBody) return
    setDrafting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalBody, originalSubject: subject, todoContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBody(plainTextToHtml(data.draft))
      setMessage('🤖 AI 草稿已生成,请审阅后发送')
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : 'AI 起草失败'}`)
    } finally {
      setDrafting(false)
    }
  }

  const externalAttachments = attachments.filter((a) => !a.isInline)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{forwardOfMessageId ? '↪️ 转发邮件' : '✉️ 写邮件'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <RecipientFields
          to={to}
          cc={cc}
          bcc={bcc}
          onTo={setTo}
          onCc={setCc}
          onBcc={setBcc}
          ownDomains={ownDomains}
        />

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">主题</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="邮件主题"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {mentionMissingAttachment && (
          <div className="rounded-md border border-orange-400/50 bg-orange-400/10 px-3 py-1.5 text-xs text-orange-300">
            ⚠️ 正文提到了附件,但尚未添加附件,确认要发送吗?
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">正文</label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
            }}
          >
            <RichTextEditor
              value={body}
              onChange={setBody}
              onInlineImage={handleInlineImage}
              onChangeDebounced={autosave}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? '⏳ 上传中...' : '📎 添加附件'}
            </Button>
            <span className="text-xs text-muted-foreground">或将文件拖入正文区域</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          {externalAttachments.length > 0 && (
            <ul className="space-y-1">
              {externalAttachments.map((a) => (
                <li key={a.key} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                  <span>{iconFor(a.mimeType)}</span>
                  <span className="flex-1 truncate text-foreground">{a.filename}</span>
                  <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                  <button type="button" onClick={() => removeAttachment(a.key)} className="text-muted-foreground hover:text-red-500" title="移除">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && <p className="text-sm">{message}</p>}

        <div className="flex gap-2">
          <Button onClick={handleSend} disabled={sending || !to || !subject || !plainBody} className="flex-1">
            {sending ? '⏳ 发送中...' : '📤 发送'}
          </Button>
          {originalBody && (
            <Button onClick={handleAiDraft} disabled={drafting} variant="outline">
              {drafting ? '⏳ AI 起草中...' : '🤖 AI 起草'}
            </Button>
          )}
          <Button onClick={handleDraft} disabled={drafting} variant="outline">
            💾 存草稿
          </Button>
          {onCancel && (
            <Button onClick={onCancel} variant="ghost">
              取消
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">🔒 安全提示:邮件不会自动发送,点击「发送」前请确认内容</p>
      </CardContent>
    </Card>
  )
}
