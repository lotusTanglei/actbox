// src/components/AttachmentList.tsx
// 邮件附件列表:按 mimeType 显示图标 + 图片 lightbox / PDF iframe 预览 / 强制下载;
// 超限未落盘项占位;病毒扫描 flagged 标警告。plan-04 Task 10。

'use client'

import { useEffect, useState } from 'react'

interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number
  contentId: string | null
  isInline: boolean
  storagePath: string | null
  scanStatus: string
  overSizeLimit: boolean
}

interface AttachmentListProps {
  messageId: number
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(mime: string | null): string {
  const m = mime || ''
  if (m.startsWith('image/')) return '🖼'
  if (m === 'application/pdf') return '📄'
  if (m.includes('zip') || m.includes('compressed')) return '🗜'
  if (m.startsWith('text/')) return '📝'
  if (m.startsWith('audio/')) return '🎵'
  if (m.startsWith('video/')) return '🎬'
  return '📎'
}

interface Preview {
  type: 'image' | 'pdf'
  url: string
  filename: string
}

export function AttachmentList({ messageId }: AttachmentListProps) {
  const [atts, setAtts] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/messages/${messageId}/attachments`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAtts(d.attachments || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  if (!atts.length) return null

  const url = (a: Attachment, inline: boolean) =>
    `/api/messages/${messageId}/attachments/${a.id}${inline ? '?inline=1' : ''}`

  const openPreview = (a: Attachment) => {
    const mime = a.mimeType || ''
    if (mime.startsWith('image/')) setPreview({ type: 'image', url: url(a, true), filename: a.filename })
    else if (mime === 'application/pdf') setPreview({ type: 'pdf', url: url(a, true), filename: a.filename })
    else window.open(url(a, false), '_blank')
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">📎 附件 ({atts.length})</h3>
      <ul className="space-y-1">
        {atts.map((a) => {
          const downloadable = !!a.storagePath
          const flagged = a.scanStatus === 'flagged'
          return (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs"
            >
              <span className="text-base">{iconFor(a.mimeType)}</span>
              <span className="flex-1 truncate text-foreground" title={a.filename}>
                {a.filename}
                {a.isInline && <span className="ml-1 text-muted-foreground">(内联)</span>}
              </span>
              <span className="text-muted-foreground">{fmtSize(a.size)}</span>
              {flagged && (
                <span title={a.scanStatus} className="text-orange-500">
                  ⚠️
                </span>
              )}
              {!downloadable ? (
                <span className="text-muted-foreground" title="超过大小上限未下载">
                  过大未下载
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openPreview(a)}
                    className="rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    预览
                  </button>
                  <a
                    href={url(a, false)}
                    download={a.filename}
                    className="rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    下载
                  </a>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {/* 预览 lightbox */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm text-white">
              <span className="truncate">{preview.filename}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded px-2 py-0.5 text-white/80 hover:bg-white/10"
              >
                ✕ 关闭
              </button>
            </div>
            {preview.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.filename} className="max-h-[80vh] max-w-[90vw] rounded" />
            ) : (
              <iframe src={preview.url} title={preview.filename} className="h-[80vh] w-[70vw] rounded bg-white" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
