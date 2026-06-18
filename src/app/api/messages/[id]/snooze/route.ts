// src/app/api/messages/[id]/snooze/route.ts
// Snooze 单封/批量：POST 置位、PATCH 取消。plan-08 Task 6。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { snoozeMessage, unsnoozeMessage } from '@/lib/snooze'

/** POST /api/messages/[id]/snooze — 延后提醒 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const db = getRawDb()

    // 批量（body.messageIds）或单封（URL id）
    let messageIds: number[]
    if (Array.isArray(body.messageIds) && body.messageIds.length) {
      messageIds = body.messageIds.map(Number)
    } else {
      messageIds = [parseInt(id, 10)]
    }

    if (body.action === 'cancel') {
      unsnoozeMessage(db, { messageIds })
      return NextResponse.json({ ok: true, action: 'cancel' })
    }

    const until = typeof body.until === 'number' ? body.until : null
    if (!until) {
      return NextResponse.json({ error: 'Missing until (epoch ms)' }, { status: 400 })
    }

    snoozeMessage(db, { messageIds, until })
    return NextResponse.json({ ok: true, until })
  } catch (error) {
    console.error('[/api/messages/[id]/snooze] Error:', error)
    return NextResponse.json({ error: 'Failed to snooze' }, { status: 500 })
  }
}

/** PATCH /api/messages/[id]/snooze — 取消延后 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const db = getRawDb()
    unsnoozeMessage(db, { messageIds: [parseInt(id, 10)] })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/messages/[id]/snooze PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to unsnooze' }, { status: 500 })
  }
}
