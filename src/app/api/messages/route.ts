// src/app/api/messages/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb, getRawDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, desc, and, or, like, not, sql } from 'drizzle-orm'
import { parseQuery } from '@/lib/search/query-parser'
import { searchMessages, type SearchSort } from '@/lib/search/fts'
import { decodeCursor, clampLimit, encodeCursor } from '@/lib/messages/cursor'

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

    // ── 游标分页 ──
    const limit = clampLimit(searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined)
    const cursorTok = searchParams.get('cursor')
    if (cursorTok !== null && cursorTok !== '' && decodeCursor(cursorTok) === null) {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400 })
    }
    const cursor = cursorTok ? decodeCursor(cursorTok) : null

    // 构造 WHERE 条件(raw SQL)
    const wheres: string[] = ['is_deleted = 0']
    const params: any[] = []

    if (showSnoozed !== 'true') {
      wheres.push('(snoozed_until IS NULL OR snoozed_until <= ?)')
      params.push(Math.floor(Date.now() / 1000))
    }
    if (direction === 'in') wheres.push("direction = 'in'")
    else if (direction === 'out') wheres.push("direction = 'out'")
    else if (direction === 'draft') wheres.push("direction = 'draft'")
    if (labelId) { wheres.push('id IN (SELECT message_id FROM message_labels WHERE label_id = ?)'); params.push(Number(labelId)) }
    if (unread === 'true') wheres.push('is_read = 0')
    if (starred === 'true') wheres.push('is_starred = 1')
    if (spam === 'true') wheres.push('is_spam = 1')
    if (search) { wheres.push('(subject LIKE ? OR sender LIKE ? OR body LIKE ?)'); const kw = `%${search}%`; params.push(kw, kw, kw) }
    if (cursor) { wheres.push('(received_at < ? OR (received_at = ? AND id < ?))'); params.push(cursor.receivedAt, cursor.receivedAt, cursor.id) }

    const whereSql = wheres.join(' AND ')
    params.push(limit + 1) // 多取 1 行判断是否有下一页

    const rows = rawDb.prepare(
      `SELECT id, message_id, subject, sender, recipient, body, body_html,
              received_at, direction, is_read, is_starred, todo_count, thread_id,
              is_spam, is_external, auth_result, spam_score
       FROM messages WHERE ${whereSql}
       ORDER BY received_at DESC, id DESC LIMIT ?`
    ).all(...params) as any[]

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(Number(page[page.length - 1].received_at), Number(page[page.length - 1].id))
      : null

    // 未读总数(不分页,轻查询)
    const unreadRow = rawDb.prepare(
      "SELECT count(*) c FROM messages WHERE direction='in' AND is_read=0 AND is_deleted=0"
    ).get() as any

    return NextResponse.json({
      messages: page,
      nextCursor,
      unreadCount: unreadRow?.c || 0,
    })
  } catch (error) {
    console.error('[/api/messages GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
