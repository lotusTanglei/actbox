// src/lib/attachments/extract.ts
// 流式 MIME multipart 解析:mailparser.simpleParser → 逐附件算 sha256 落盘 + 记表。
// 保留 Content-ID(内联渲染用);超 perAttachment 上限「记表不落盘」;病毒扫描钩子可插拔(默认 no-op)。
// plan-04 Task 4。

import crypto from 'crypto'
import type Database from 'better-sqlite3'
import { simpleParser } from 'mailparser'
import { storeContent } from './store'
import { sanitizeFilename, DEFAULT_LIMITS } from './sanitize'
import type { SizeLimits } from './sanitize'
import { NOOP_SCAN } from './scan-hook'
import type { ScanHook } from './scan-hook'

export interface ExtractedAttachment {
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

export interface ExtractOpts {
  accountId: number
  messageId: number
  root: string
  db: Database.Database
  scan?: ScanHook
  limits?: SizeLimits
}

/** Content-ID 归一为带尖括号的 MIME 规范形式('<img1>')。 */
function normalizeCid(cid: unknown): string | null {
  if (!cid) return null
  const s = String(cid).replace(/^<|>$/g, '')
  return s ? `<${s}>` : null
}

/**
 * 解析原始 MIME 源,逐附件落盘 + 记 attachments 表,返回入库行。
 * 单个附件失败不阻断其余(记日志、跳过)。
 */
export async function extractAttachments(
  rawSource: Buffer | string,
  opts: ExtractOpts,
): Promise<ExtractedAttachment[]> {
  const limits = opts.limits ?? DEFAULT_LIMITS
  const scan = opts.scan ?? NOOP_SCAN
  const parsed = await simpleParser(rawSource)
  const list = (parsed.attachments || []) as NonNullable<typeof parsed.attachments>
  const out: ExtractedAttachment[] = []
  const now = Math.floor(Date.now() / 1000)

  for (const a of list) {
    try {
      const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from((a.content as Uint8Array) ?? '')
      const filename = sanitizeFilename(a.filename || 'attachment')
      const mimeType = (a.contentType || '').split(';')[0].trim() || null
      const size = content.length
      const cid = normalizeCid(a.cid)
      const isInline = a.contentDisposition === 'inline' || !!cid

      let storagePath: string | null = null
      let sha: string | null = null
      let overSizeLimit = false
      let scanStatus = 'ok'
      let scanReason: string | null = null

      if (size > limits.perAttachment) {
        overSizeLimit = true // 记表不落盘、不扫描
      } else {
        sha = crypto.createHash('sha256').update(content).digest('hex')
        storagePath = await storeContent(opts.root, content, {
          accountId: opts.accountId,
          messageId: opts.messageId,
        })
        const sr = await scan(content, { filename, mimeType })
        scanStatus = sr.ok ? 'ok' : 'flagged'
        scanReason = sr.reason ?? null
      }

      const r = opts.db
        .prepare(
          `INSERT INTO attachments
             (account_id, message_id, filename, mime_type, size, content_id, is_inline,
              storage_path, sha256, scan_status, scan_reason, over_size_limit, downloaded_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          opts.accountId,
          opts.messageId,
          filename,
          mimeType,
          size,
          cid,
          isInline ? 1 : 0,
          storagePath,
          sha,
          scanStatus,
          scanReason,
          overSizeLimit ? 1 : 0,
          now,
        )

      out.push({
        id: Number(r.lastInsertRowid),
        accountId: opts.accountId,
        messageId: opts.messageId,
        filename,
        mimeType,
        size,
        contentId: cid,
        isInline,
        storagePath,
        sha256: sha,
        scanStatus,
        scanReason,
        overSizeLimit,
        downloadedAt: now,
      })
    } catch (e) {
      console.error('[extract] attachment failed:', e instanceof Error ? e.message : e)
    }
  }
  return out
}
