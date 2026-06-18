// src/app/api/messages/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb, getRawDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, and, not } from 'drizzle-orm'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'
import { applyAction, type WritebackAction } from '@/lib/sync/writeback'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_ACTIONS: WritebackAction[] = ['markRead', 'star', 'move', 'archive', 'restore', 'delete']

// 账号缺失时仅本地更新(no-op 回写)
const LOCAL_ONLY_ADAPTER = {
  markRead: async () => {},
  move: async () => {},
  delete: async () => {},
}

/** GET /api/messages/[id] — 邮件详情 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const db = getDb()
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = db
      .select()
      .from(messages)
      .where(and(eq(messages.id, msgId), not(eq(messages.isDeleted, true))))
      .all()

    if (!result.length) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // 自动标为已读
    db.update(messages)
      .set({ isRead: true })
      .where(eq(messages.id, msgId))
      .run()

    return NextResponse.json({ message: result[0] })
  } catch (error) {
    console.error('[/api/messages/[id] GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch message' }, { status: 500 })
  }
}

/** PATCH /api/messages/[id] — 更新(已读/星标)或执行动作(archive/move/restore/delete/markRead/star) */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json()

    // 动作分支:走 writeback(乐观更新 + UID 回写)
    if (body?.action) {
      if (!VALID_ACTIONS.includes(body.action)) {
        return NextResponse.json({ error: `非法 action: ${body.action}` }, { status: 400 })
      }
      const raw = getRawDb()
      const row = raw.prepare('SELECT account_id FROM messages WHERE id = ?').get(msgId) as
        | { account_id: number | null }
        | undefined
      if (!row) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      const accountId = row.account_id
      const adapter = accountId != null ? (getAdapter(accountId) ?? LOCAL_ONLY_ADAPTER) : LOCAL_ONLY_ADAPTER
      await applyAction(raw, {
        adapter: adapter as any,
        action: body.action,
        messageIds: [msgId],
        value: body.value,
        targetFolder: body.targetFolder,
      })
      const updated = raw.prepare('SELECT * FROM messages WHERE id = ?').get(msgId)
      return NextResponse.json({ message: updated })
    }

    // 兼容旧路径:直接改 isRead/isStarred
    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (body.isRead !== undefined) updates.isRead = body.isRead
    if (body.isStarred !== undefined) updates.isStarred = body.isStarred

    const result = db
      .update(messages)
      .set(updates)
      .where(eq(messages.id, msgId))
      .returning()
      .all()

    if (!result.length) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({ message: result[0] })
  } catch (error) {
    console.error('[/api/messages/[id] PATCH] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update message'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** DELETE /api/messages/[id] — 软删除 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const db = getDb()
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = db
      .update(messages)
      .set({ isDeleted: true })
      .where(eq(messages.id, msgId))
      .returning()
      .all()

    if (!result.length) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/messages/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 })
  }
}
