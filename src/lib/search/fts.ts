// src/lib/search/fts.ts
// FTS5 查询构造:列限定 MATCH + bm25 排序 + 结构化过滤(account/folder/unread/starred/date/attachment)。
// 列名白名单枚举拼接(非用户输入),tokenizeQuery 切词后用 phrase 包裹特殊字符。plan-07 Task 5。

import type Database from 'better-sqlite3'
import type { ParsedQuery } from '@/lib/search/query-parser'
import { tokenizeQuery } from '@/lib/search/segmenter'

export type SearchSort = 'relevance' | 'time' | 'sender'

export interface SearchOpts {
  sort?: SearchSort
  accountId?: number
  folder?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface SearchHit {
  id: number
  messageId: string
  subject: string | null
  sender: string | null
  receivedAt: number | null
  isRead: number
  isStarred: number
  accountId: number | null
  folder: string | null
}

const SELECT_COLS =
  'm.id, m.message_id AS messageId, m.subject, m.sender, m.received_at AS receivedAt, m.is_read AS isRead, m.is_starred AS isStarred, m.account_id AS accountId, m.folder'

/** 主搜索入口:构造 FTS5 MATCH + 结构化条件,返回命中(已排序+分页)。 */
export function searchMessages(db: Database.Database, parsed: ParsedQuery, opts: SearchOpts = {}): SearchHit[] {
  const sort = opts.sort ?? 'relevance'
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  const where: string[] = []
  const params: (string | number)[] = []

  const matchExpr = buildMatchExpr(parsed)
  const hasMatch = matchExpr.length > 0

  if (!opts.includeDeleted) where.push('m.is_deleted = 0')
  if (opts.accountId != null) {
    where.push('m.account_id = ?')
    params.push(opts.accountId)
  }
  if (opts.folder) {
    where.push('m.folder = ?')
    params.push(opts.folder)
  }
  if (parsed.isUnread) where.push('m.is_read = 0')
  if (parsed.isStarred) where.push('m.is_starred = 1')
  if (parsed.after) {
    where.push('m.received_at >= ?')
    params.push(Math.floor(parsed.after.getTime() / 1000))
  }
  if (parsed.before) {
    where.push('m.received_at < ?')
    params.push(Math.floor(parsed.before.getTime() / 1000))
  }
  if (parsed.hasAttachment) {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)')
  }

  // bm25 仅在有 MATCH(FTS 在查询中)时可用;无 MATCH 时 relevance 回退为时间倒序
  let orderBy: string
  if (!hasMatch || sort === 'time') orderBy = 'm.received_at DESC'
  else if (sort === 'sender') orderBy = 'm.sender ASC'
  else orderBy = 'bm25(messages_fts, 12.0, 6.0, 6.0, 1.0, 1.0)'

  let sql: string
  if (hasMatch) {
    sql = `SELECT ${SELECT_COLS} FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
           WHERE messages_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''}
           ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    params.unshift(matchExpr)
  } else {
    sql = `SELECT ${SELECT_COLS} FROM messages m
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  }
  params.push(limit, offset)
  return db.prepare(sql).all(...params) as unknown as SearchHit[]
}

/** 构造 FTS5 MATCH 表达式(列限定)。列名白名单枚举,非用户输入,安全拼接。 */
function buildMatchExpr(parsed: ParsedQuery): string {
  const parts: string[] = []
  if (parsed.subject) parts.push(`subject:${ftok(parsed.subject)}`)
  if (parsed.from) parts.push(`sender:${ftok(parsed.from)}`)
  if (parsed.to) parts.push(`"to":${ftok(parsed.to)}`)
  if (parsed.freeText) parts.push(ftok(parsed.freeText))
  return parts.join(' ').trim()
}

function ftok(s: string): string {
  const seg = tokenizeQuery(s)
  return seg
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/[\s:"()-]/.test(t) ? `"${t}"` : t))
    .join(' ')
}
