// src/app/api/messages/batch/route.ts
// 批量操作：archive/delete/markRead/star/move/label/unlabel/snooze/restore。
// plan-08 Task 8。

import { NextRequest, NextResponse } from 'next/server'
import { getDb, getRawDb } from '@/lib/db'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'
import { applyAction } from '@/lib/sync/writeback'
import { snoozeMessage, unsnoozeMessage } from '@/lib/snooze'

const VALID_ACTIONS = new Set([
  'markRead', 'star', 'move', 'archive', 'restore', 'delete', 'label', 'unlabel', 'snooze',
])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messageIds, action, value, targetFolder, labelIds, until } = body

    // 校验
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: 'messageIds 必须是非空数组' }, { status: 400 })
    }
    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: `非法 action: ${action}` }, { status: 400 })
    }

    const db = getRawDb()
    const ids = messageIds.map(Number)

    // snooze 单独处理（无需 adapter）
    if (action === 'snooze') {
      if (until === undefined || until === null) {
        unsnoozeMessage(db, { messageIds: ids })
      } else {
        snoozeMessage(db, { messageIds: ids, until })
      }
      return NextResponse.json({ updated: ids.length })
    }

    // 标签操作也无需 adapter
    if (action === 'label' || action === 'unlabel') {
      await applyAction(db, {
        adapter: null as any, // label/unlabel 不调 adapter
        action,
        messageIds: ids,
        labelIds: labelIds ?? undefined,
      })
      return NextResponse.json({ updated: ids.length })
    }

    // 先取第一封的 accountId 以获取 adapter
    const first = db.prepare('SELECT account_id FROM messages WHERE id = ?').get(ids[0]) as { account_id: number } | undefined
    if (!first) {
      return NextResponse.json({ error: '邮件不存在' }, { status: 404 })
    }

    const adapter = getAdapter(first.account_id, { db: getDb() })
    if (!adapter) {
      return NextResponse.json({ error: '账号适配器不可用' }, { status: 400 })
    }

    await applyAction(db, {
      adapter,
      action,
      messageIds: ids,
      value: value ?? undefined,
      targetFolder: targetFolder ?? undefined,
      labelIds: labelIds ?? undefined,
    })

    return NextResponse.json({ updated: ids.length })
  } catch (error) {
    console.error('[/api/messages/batch] Error:', error)
    return NextResponse.json({ error: 'Batch operation failed' }, { status: 500 })
  }
}
