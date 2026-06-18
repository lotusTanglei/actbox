// src/app/api/messages/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb, getRawDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, desc, and, or, like, not, sql } from 'drizzle-orm'
import { parseQuery } from '@/lib/search/query-parser'
import { searchMessages, type SearchSort } from '@/lib/search/fts'

/** GET /api/messages — 邮件列表/搜索。q|search 非空走 FTS5(跨文件夹/账号);否则结构化过滤。 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(request.url)

    // FTS5 全文搜索路径(plan-07 Task 6)
    const q = searchParams.get('q') ?? searchParams.get('search')
    if (q && q.trim()) {
      const sort = (searchParams.get('sort') as SearchSort) ?? 'relevance'
      const accountId = searchParams.get('accountId')
      const folder = searchParams.get('folder') ?? undefined
      const offset = Number(searchParams.get('offset') ?? 0)
      const hits = searchMessages(getRawDb(), parseQuery(q), {
        sort,
        accountId: accountId ? Number(accountId) : undefined,
        folder,
        limit: 50,
        offset: isNaN(offset) ? 0 : offset,
      })
      return NextResponse.json({ messages: hits })
    }

    const direction = searchParams.get('direction') || 'in' // in | out | draft
    const search = searchParams.get('search') // (旧)关键词,已并入上面的 q 路径
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
