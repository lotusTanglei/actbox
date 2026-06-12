// src/app/api/draft/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { not } from 'drizzle-orm'

/** GET /api/draft — 获取草稿列表 */
export async function GET() {
  try {
    const db = getDb()
    const result = db
      .select()
      .from(messages)
      .where(and(eq(messages.direction, 'draft'), not(eq(messages.isDeleted, true))))
      .all()
    return NextResponse.json({ drafts: result })
  } catch (error) {
    console.error('[/api/draft GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 })
  }
}

/** POST /api/draft — 保存草稿 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, body: mailBody } = body

    const db = getDb()
    const result = db.insert(messages).values({
      messageId: `draft-${Date.now()}`,
      subject: subject || '(无主题)',
      from: process.env.IMAP_USER || '',
      to: to || '',
      body: mailBody || '',
      direction: 'draft',
      isRead: true,
    }).returning().all()

    return NextResponse.json({ draft: result[0] }, { status: 201 })
  } catch (error) {
    console.error('[/api/draft POST] Error:', error)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }
}
