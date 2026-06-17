// src/app/api/messages/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, desc, and, or, like, not, sql } from 'drizzle-orm'

/** GET /api/messages — 邮件列表，支持筛选和搜索 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(request.url)
    const direction = searchParams.get('direction') || 'in' // in | out | draft
    const search = searchParams.get('search') // 关键词搜索
    const starred = searchParams.get('starred') // 'true' = 只看星标
    const unread = searchParams.get('unread') // 'true' = 只看未读

    // 基础条件：不删除
    const conditions = [not(eq(messages.isDeleted, true))]

    // 方向筛选（精确：out 仅已发送，draft 仅草稿）
    if (direction === 'in') {
      conditions.push(eq(messages.direction, 'in'))
    } else if (direction === 'out') {
      conditions.push(eq(messages.direction, 'out'))
    } else if (direction === 'draft') {
      conditions.push(eq(messages.direction, 'draft'))
    }

    // 未读筛选
    if (unread === 'true') {
      conditions.push(eq(messages.isRead, false))
    }

    // 星标筛选
    if (starred === 'true') {
      conditions.push(eq(messages.isStarred, true))
    }

    // 搜索
    if (search) {
      const keyword = `%${search}%`
      conditions.push(
        or(
          like(messages.subject, keyword),
          like(messages.from, keyword),
          like(messages.body, keyword)
        )!
      )
    }

    const result = db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.receivedAt))
      .all()

    // 统计未读数
    const unreadResult = db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.direction, 'in'),
          eq(messages.isRead, false),
          not(eq(messages.isDeleted, true))
        )
      )
      .all()

    return NextResponse.json({
      messages: result,
      unreadCount: unreadResult[0]?.count || 0,
    })
  } catch (error) {
    console.error('[/api/messages GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
