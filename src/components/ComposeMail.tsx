// src/components/ComposeMail.tsx

'use client'

import { useState } from 'react'
import { htmlToText } from 'html-to-text'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RichTextEditor } from '@/components/RichTextEditor'

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
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // 正文纯文本（用于校验/摘要/不支持 HTML 的客户端）；body 本身是 HTML
  const plainBody = htmlToText(body).trim()

  const handleSend = async () => {
    if (!to || !subject || !plainBody) return
    setSending(true)
    setMessage(null)

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body: plainBody, bodyHtml: body, replyToMessageId }),
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
          <RichTextEditor value={body} onChange={setBody} />
        </div>

        {message && (
          <p className="text-sm">{message}</p>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSend}
            disabled={sending || !to || !subject || !plainBody}
            className="flex-1"
          >
            {sending ? '⏳ 发送中...' : '📤 发送'}
          </Button>
          {originalBody && (
            <Button
              onClick={handleAiDraft}
              disabled={drafting}
              variant="outline"
            >
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
