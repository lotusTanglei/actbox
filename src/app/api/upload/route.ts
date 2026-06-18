// src/app/api/upload/route.ts
// 撰写时上传待发附件:multipart file → sanitizeFilename + size 校验 → 落盘 attachments/tmp/{sha256}.bin
// → 返回 {filename,size,mimeType,sha256,storagePath,cid?}。粘贴截图走同端点(body inline=1 生成 cid)。
// plan-04 Task 8。

import { NextRequest, NextResponse } from 'next/server'
import { storeTmpContent, getAttachmentsRoot } from '@/lib/attachments/store'
import { sanitizeFilename, DEFAULT_LIMITS } from '@/lib/attachments/sanitize'

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: '未提供文件(file)' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const filename = sanitizeFilename(file.name)
    const mimeType = file.type || 'application/octet-stream'
    const size = buf.length

    if (size > DEFAULT_LIMITS.perAttachment) {
      return NextResponse.json(
        { error: '文件过大', limit: DEFAULT_LIMITS.perAttachment },
        { status: 413 },
      )
    }

    const { storagePath, sha256 } = await storeTmpContent(getAttachmentsRoot(), buf)

    // 内联图片(粘贴截图)生成 cid;外联附件无 cid
    const isInline = form.get('inline') === '1'
    const cid = isInline ? `actbox-${sha256.slice(0, 12)}` : undefined

    return NextResponse.json({ filename, size, mimeType, sha256, storagePath, cid })
  } catch (error) {
    console.error('[/api/upload POST] Error:', error)
    return NextResponse.json({ error: '上传失败' }, { status: 500 })
  }
}
