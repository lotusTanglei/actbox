// src/app/api/messages/[id]/attachments/route.ts
// 附件列表。plan-04 Task 7。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { listByMessage } from '@/lib/attachments/repo'

type RouteContext = { params: Promise<{ id: string }> }

/** GET /api/messages/[id]/attachments — 该消息附件列表(filename/size/mimeType/isInline...) */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const db = getRawDb()
    const attachments = listByMessage(db, msgId)
    return NextResponse.json({ attachments })
  } catch (error) {
    console.error('[/api/messages/[id]/attachments GET] Error:', error)
    return NextResponse.json({ error: 'Failed to list attachments' }, { status: 500 })
  }
}
