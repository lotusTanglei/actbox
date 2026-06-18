// src/app/api/draft/[id]/route.ts
// 草稿续编/查/删(仅 direction='draft' 行)。plan-05 Task 6。

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

async function getDraft(db: ReturnType<typeof getDb>, id: number) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.direction, 'draft')))
    .all()[0]
}

/** GET /api/draft/[id] — 草稿全字段 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    const draft = await getDraft(getDb(), msgId)
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    return NextResponse.json({ draft })
  } catch (error) {
    console.error('[/api/draft/[id] GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 })
  }
}

/** PATCH /api/draft/[id] — 全量覆盖 to/cc/bcc/subject/body/bodyHtml(前端每次传全量) */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const db = getDb()
    const body = await request.json()
    const result = db
      .update(messages)
      .set({
        to: body.to ?? null,
        cc: body.cc ?? null,
        bcc: body.bcc ?? null,
        subject: body.subject ?? null,
        body: body.body ?? '',
        bodyHtml: body.bodyHtml ?? null,
      })
      .where(and(eq(messages.id, msgId), eq(messages.direction, 'draft')))
      .returning()
      .all()

    if (!result.length) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    return NextResponse.json({ draft: result[0] })
  } catch (error) {
    console.error('[/api/draft/[id] PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }
}

/** DELETE /api/draft/[id] — 物理删草稿行 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const msgId = parseInt(id, 10)
    if (isNaN(msgId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const db = getDb()
    const result = db
      .delete(messages)
      .where(and(eq(messages.id, msgId), eq(messages.direction, 'draft')))
      .returning()
      .all()
    if (!result.length) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/draft/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 })
  }
}
