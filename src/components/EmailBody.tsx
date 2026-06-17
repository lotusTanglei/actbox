// src/components/EmailBody.tsx
// 邮件正文渲染：HTML 用 iframe 白底沙盒（忠实还原邮件自带样式、隔离脚本），
// 纯文本用白底 pre。两者都是"白信纸"观感，不受深色主题影响。

'use client'

import { useEffect, useRef, useState } from 'react'

interface EmailBodyProps {
  html?: string | null
  text?: string | null
}

export function EmailBody({ html, text }: EmailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [height, setHeight] = useState(480)

  const measure = () => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight)
    if (h > 0) setHeight(h)
  }

  const handleLoad = () => {
    measure()
    roRef.current?.disconnect()
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    // 监听正文尺寸变化（图片懒加载等），实时自适应高度
    const ro = new ResizeObserver(measure)
    ro.observe(doc.body)
    ro.observe(doc.documentElement)
    roRef.current = ro
  }

  useEffect(() => () => roRef.current?.disconnect(), [])

  if (html) {
    return (
      <iframe
        ref={iframeRef}
        srcDoc={html}
        title="邮件正文"
        sandbox="allow-same-origin"
        onLoad={handleLoad}
        className="w-full rounded-lg border-0 bg-white"
        style={{ height, colorScheme: 'light' }}
      />
    )
  }

  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg bg-white p-4 font-sans text-sm leading-relaxed text-neutral-900">
      {text || '(无正文)'}
    </pre>
  )
}
