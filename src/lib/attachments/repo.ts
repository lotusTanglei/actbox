// src/lib/attachments/repo.ts
// attachments 表读写:列表/查单/计数/标记扫描;releaseByMessage 包装 store(GC 物理文件)。
// raw better-sqlite3:bool 列(0/1)映射为 boolean。plan-04 Task 5。

import type Database from 'better-sqlite3'
import { releaseByMessage as storeReleaseByMessage, type ReleaseStats } from './store'

export interface AttachmentRow {
  id: number
  accountId: number
  messageId: number
  filename: string
  mimeType: string | null
  size: number
  contentId: string | null
  isInline: boolean
  storagePath: string | null
  sha256: string | null
  scanStatus: string
  scanReason: string | null
  overSizeLimit: boolean
  downloadedAt: number
}

interface RawRow {
  id: number
  account_id: number
  message_id: number
  filename: string
  mime_type: string | null
  size: number
  content_id: string | null
  is_inline: number
  storage_path: string | null
  sha256: string | null
  scan_status: string
  scan_reason: string | null
  over_size_limit: number
  downloaded_at: number
}

function mapRow(r: RawRow): AttachmentRow {
  return {
    id: r.id,
    accountId: r.account_id,
    messageId: r.message_id,
    filename: r.filename,
    mimeType: r.mime_type,
    size: r.size,
    contentId: r.content_id,
    isInline: !!r.is_inline,
    storagePath: r.storage_path,
    sha256: r.sha256,
    scanStatus: r.scan_status,
    scanReason: r.scan_reason,
    overSizeLimit: !!r.over_size_limit,
    downloadedAt: r.downloaded_at,
  }
}

const SELECT = `SELECT id, account_id, message_id, filename, mime_type, size, content_id,
  is_inline, storage_path, sha256, scan_status, scan_reason, over_size_limit, downloaded_at
  FROM attachments`

/** 列出某消息全部附件(inline 排前)。 */
export function listByMessage(db: Database.Database, messageId: number): AttachmentRow[] {
  const rows = db.prepare(`${SELECT} WHERE message_id = ? ORDER BY is_inline DESC, id ASC`).all(messageId) as RawRow[]
  return rows.map(mapRow)
}

export function getById(db: Database.Database, id: number): AttachmentRow | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as RawRow | undefined
  return row ? mapRow(row) : null
}

/** 某 sha256 被多少行引用(去重/回收判断)。 */
export function countBySha256(db: Database.Database, sha256: string): number {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE sha256 = ?').get(sha256) as { c: number }
  return c
}

/** 标记某附件扫描命中(flagged + 原因)。 */
export function markScanFlag(db: Database.Database, id: number, reason: string): void {
  db.prepare(`UPDATE attachments SET scan_status = 'flagged', scan_reason = ? WHERE id = ?`).run(reason, id)
}

/** 删除某消息全部附件行 + 回收独占物理文件(委托 store)。 */
export function releaseByMessage(
  db: Database.Database,
  root: string,
  messageId: number,
): Promise<ReleaseStats> {
  return storeReleaseByMessage(db, root, messageId)
}
