// src/components/ComposeMail.tsx

'use client'

import { useRef, useState } from 'react'
import { htmlToText } from 'html-to-text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RichTextEditor } from '@/components/RichTextEditor'

/** 上传端点返回的待发附件元数据 */
export interface PendingAttachment {
  key: string
  filename: string
  size: number
  mimeType: string
  storagePath: string // 相对根(attachments/tmp/{sha}.bin)
  cid?: string // 内联图片才有
  isInline: boolean
}

interface ComposeMailProps {
  /** 预填收件人 */
  to?: string
  /** 预填主题 */
  subject?: string
  /** 预填正文（AI 草稿等） */
  initialBody?: string
  /** 原始邮件 messageId（回复时引用） */
  replyToMessageId?: string
  /** 原始邮件正文（AI 起草用） */
  originalBody?: string
  /** 关联待办（AI 起草用） */
  todoContext?: string
  /** 发送/保存后回调 */
  onDone?: () => void
  /** 取消回调 */
  onCancel?: () => void
}

/** 纯文本（AI 起草结果）转 HTML 段落，便于塞进富文本编辑器 */
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
  subject: initialSubject = '',
  initialBody = '',
  replyToMessageId,
  originalBody,
  todoContext,
  onDone,
  onCancel,
}: ComposeMailProps) {
  const [to, setTo] = useState(initialTo)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const keySeq = useRef(0)

  // 正文纯文本（用于校验/摘要/不支持 HTML 的客户端）；body 本身是 HTML
  const plainBody = htmlToText(body).trim()

  /** 上传单个文件到 /api/upload,返回待发元数据 */
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

  // 编辑器粘贴/拖入图片 → 上传拿 cid → 插入 <img src="cid:...">
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

  const removeAttachment = (key: string) => {
    setAttachments((prev) => prev.filter((a) => a.key !== key))
  }

  const handleSend = async () => {
    if (!to || !subject || !plainBody) return
    setSending(true)
    setMessage(null)

    try {
      // 外联附件给 storagePath(服务端解析绝对路径);内联给 cid
      const payload = attachments.map((a) => ({
        filename: a.filename,
        storagePath: a.isInline ? undefined : a.storagePath,
        cid: a.cid,
      }))
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body: plainBody, bodyHtml: body, replyToMessageId, attachments: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
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
        body: JSON.stringify({ to, subject, body: plainBody, bodyHtml: body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
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
        body: JSON.stringify({
          originalBody,
          originalSubject: subject,
          todoContext,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBody(plainTextToHtml(data.draft))
      setMessage('🤖 AI 草稿已生成，请审阅后发送')
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : 'AI 起草失败'}`)
    } finally {
      setDrafting(false)
    }
  }

  // 外联附件(内联的在正文 cid 位置)
  const externalAttachments = attachments.filter((a) => !a.isInline)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">✉️ 写邮件</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">收件人</label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
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
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">正文</label>
          <div
            onDragOver={(e) => {
              e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
            }}
          >
            <RichTextEditor value={body} onChange={setBody} onInlineImage={handleInlineImage} />
          </div>
        </div>

        {/* 附件区 */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
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
                <li
                  key={a.key}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                >
                  <span>{iconFor(a.mimeType)}</span>
                  <span className="flex-1 truncate text-foreground">{a.filename}</span>
                  <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.key)}
                    className="text-muted-foreground hover:text-red-500"
                    title="移除"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && <p className="text-sm">{message}</p>}

        <div className="flex gap-2">
          <Button
            onClick={handleSend}
            disabled={sending || !to || !subject || !plainBody}
            className="flex-1"
          >
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

        <p className="text-xs text-muted-foreground">
          🔒 安全提示：邮件不会自动发送，点击「发送」前请确认内容
        </p>
      </CardContent>
    </Card>
  )
}
