// src/app/api/messages/[id]/attachments/[aid]/route.ts
// 附件下载/预览:默认强制 Content-Disposition: attachment(下载);?inline=1 → inline(内联渲染)。
// 非 ASCII 文件名用 RFC 5987 filename*。超限未落盘(storagePath 空)→ 404 not_downloaded。
// Node fs 流 → web ReadableStream 返回。plan-04 Task 7。

import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { getRawDb } from '@/lib/db'
import { getById } from '@/lib/attachments/repo'
import { readStream, getAttachmentsRoot } from '@/lib/attachments/store'

type RouteContext = { params: Promise<{ id: string; aid: string }> }

/** 构造 Content-Disposition:inline/attachment + ASCII filename 兜底 + 非 ASCII 用 RFC5987 filename*。 */
function contentDisposition(filename: string, inline: boolean): string {
  const type = inline ? 'inline' : 'attachment'
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'attachment'
  const encoded = encodeURIComponent(filename)
  if (encoded !== filename) {
    return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
  }
  return `${type}; filename="${ascii}"`
}

/** GET /api/messages/[id]/attachments/[aid]?inline=0|1 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id, aid } = await context.params
    const msgId = parseInt(id, 10)
    const attId = parseInt(aid, 10)
    if (isNaN(msgId) || isNaN(attId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const db = getRawDb()
    const att = getById(db, attId)
    if (!att || att.messageId !== msgId) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }
    if (!att.storagePath) {
      return NextResponse.json({ error: 'not_downloaded', reason: 'over_size_limit' }, { status: 404 })
    }

    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const headers = new Headers({
      'Content-Type': att.mimeType || 'application/octet-stream',
      'Content-Length': String(att.size),
      'Content-Disposition': contentDisposition(att.filename, inline),
      'Content-Security-Policy': "default-src 'none'",
    })

    const nodeStream = readStream(getAttachmentsRoot(), att.storagePath)
    return new Response(Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, { headers })
  } catch (error) {
    console.error('[/api/messages/[id]/attachments/[aid] GET] Error:', error)
    return NextResponse.json({ error: 'Failed to serve attachment' }, { status: 500 })
  }
}
