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
    const rawDb = getRawDb()
    const { searchParams } = new URL(request.url)

    // FTS5 全文搜索路径(plan-07 Task 6)
    const q = searchParams.get('q') ?? searchParams.get('search')
    if (q && q.trim()) {
      const sort = (searchParams.get('sort') as SearchSort) ?? 'relevance'
      const accountId = searchParams.get('accountId')
      const folder = searchParams.get('folder') ?? undefined
      const offset = Number(searchParams.get('offset') ?? 0)
      const hits = searchMessages(rawDb, parseQuery(q), {
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
    const labelId = searchParams.get('labelId') // 按标签过滤
    const showSnoozed = searchParams.get('snoozed') // 'true' = 显示已延后邮件
    const spam = searchParams.get('spam') // 'true' = 只看垃圾邮件
    const threadGroup = searchParams.get('thread') // 'group' = 按会话折叠
    const threadId = searchParams.get('threadId') // 展开特定会话

    // 会话展开：按 thread_id 返回该会话全部邮件
    if (threadId) {
      const rows = rawDb
        .prepare(
          `SELECT * FROM messages
           WHERE thread_id = ? AND is_deleted = 0
           ORDER BY received_at ASC`,
        )
        .all(threadId) as any[]
      return NextResponse.json({ messages: rows })
    }

    // 会话折叠：按 thread_id GROUP BY，返回每会话最新一封 + count
    if (threadGroup === 'group') {
      const conditions: string[] = ['is_deleted = 0', "direction = 'in'"]
      const params: any[] = []

      // 排除未到期 snoozed（除非显式看延后视图）
      if (showSnoozed !== 'true') {
        conditions.push('(snoozed_until IS NULL OR snoozed_until <= ?)')
        params.push(Math.floor(Date.now() / 1000))
      }

      if (labelId) {
        conditions.push('id IN (SELECT message_id FROM message_labels WHERE label_id = ?)')
        params.push(Number(labelId))
      }

      if (unread === 'true') conditions.push('is_read = 0')
      if (starred === 'true') conditions.push('is_starred = 1')

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = rawDb
        .prepare(
          `SELECT thread_id AS threadId,
                  MAX(received_at) AS latestReceivedAt,
                  COUNT(*) AS count,
                  SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unreadCount
           FROM messages
           ${where}
           GROUP BY thread_id
           ORDER BY latestReceivedAt DESC`,
        )
        .all(...params) as any[]

      // 为每个 thread 取最新一封邮件的完整信息
      const results = rows.map((t: any) => {
        const latest = rawDb
          .prepare(
            `SELECT * FROM messages
             WHERE thread_id = ? AND is_deleted = 0
             ORDER BY received_at DESC LIMIT 1`,
          )
          .get(t.threadId) as any
        return { ...latest, threadId: t.threadId, count: t.count, unreadCount: t.unreadCount }
      })

      return NextResponse.json({ messages: results })
    }

    // 基础条件：不删除
    const conditions = [not(eq(messages.isDeleted, true))]

    // 排除未到期 snoozed（除非显式看延后视图）。plan-08 Task 7
    if (showSnoozed !== 'true') {
      conditions.push(
        or(
          sql`${messages.snoozedUntil} IS NULL`,
          sql`${messages.snoozedUntil} <= ${Math.floor(Date.now() / 1000)}`,
        )!
      )
    }

    // 方向筛选（精确：out 仅已发送，draft 仅草稿）
    if (direction === 'in') {
      conditions.push(eq(messages.direction, 'in'))
    } else if (direction === 'out') {
      conditions.push(eq(messages.direction, 'out'))
    } else if (direction === 'draft') {
      conditions.push(eq(messages.direction, 'draft'))
    }

    // 按标签过滤。plan-08 Task 7
    if (labelId) {
      conditions.push(
        sql`${messages.id} IN (SELECT message_id FROM message_labels WHERE label_id = ${Number(labelId)})`,
      )
    }

    // 未读筛选
    if (unread === 'true') {
      conditions.push(eq(messages.isRead, false))
    }

    // 星标筛选
    if (starred === 'true') {
      conditions.push(eq(messages.isStarred, true))
    }

    // 垃圾邮件筛选
    if (spam === 'true') {
      conditions.push(eq(messages.isSpam, true))
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
