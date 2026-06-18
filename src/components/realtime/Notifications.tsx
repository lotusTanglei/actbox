// src/components/realtime/Notifications.tsx
// Notification API 桌面/浏览器通知:授权提示 + 新邮件分级通知(tag 幂等)+ 角标。
// INBOX 默认通知;垃圾/草稿静默。plan-06 Task 9。

'use client'

import { useEffect, useState } from 'react'
import { useMailEvents } from './useMailEvents'

// 静默文件夹(不弹通知)
const SILENT_FOLDERS = new Set(['Spam', 'Junk', 'Drafts', 'Trash', '已删除', '草稿', '垃圾邮件'])

function applyBadge(unread: number) {
  try {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(unread || 0).catch(() => {})
    }
  } catch {
    /* ignore */
  }
  document.title = unread > 0 ? `(${unread}) ActBox` : 'ActBox'
}

export function Notifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )

  useEffect(() => {
    applyBadge(0)
  }, [])

  const requestPerm = async () => {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission()
    setPermission(p)
  }

  useMailEvents({
    onNewMail: (p) => {
      if (SILENT_FOLDERS.has(p.folder)) return
      if (permission !== 'granted' || typeof Notification === 'undefined') return
      try {
        new Notification(`新邮件 · ${p.from || '未知'}`, {
          body: p.subject || '(无主题)',
          tag: p.messageId, // 幂等:同 messageId 不重复弹
        })
      } catch {
        /* ignore */
      }
    },
    onUnreadCount: (p) => {
      if (p.folder === 'INBOX') applyBadge(p.unread)
    },
  })

  if (typeof Notification === 'undefined' || permission !== 'default') return null

  return (
    <button
      onClick={requestPerm}
      className="fixed bottom-4 right-4 z-40 rounded-full bg-primary px-4 py-2 text-xs text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
    >
      🔔 开启桌面通知
    </button>
  )
}
