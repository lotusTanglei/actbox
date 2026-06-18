// src/__tests__/attachments/extract.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { extractAttachments } from '@/lib/attachments/extract'
import { memDb } from '../helpers/memDb'

interface Part {
  filename: string
  cid?: string
  mime: string
  data: Buffer
}

/** 构造 multipart/mixed 原始 MIME(text 正文 + inline cid 图片 + 外联附件)。
 *  必须有 text 正文 part,否则 mailparser 会把唯一的 text/plain 附件吞成正文。 */
function buildMime(o: { inline?: Part; attach?: Part }): Buffer {
  const boundary = 'B_' + Math.random().toString(36).slice(2, 10)
  const lines: string[] = [
    'From: a@b.com',
    'To: c@d.com',
    'Subject: t',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    'preamble',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'hello body',
  ]
  const pushPart = (p: Part, disp: 'inline' | 'attachment') => {
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${p.mime}; name="${p.filename}"`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: ${disp}; filename="${p.filename}"`)
    if (p.cid) lines.push(`Content-ID: <${p.cid}>`)
    lines.push('')
    lines.push(p.data.toString('base64'))
  }
  if (o.inline) pushPart(o.inline, 'inline')
  if (o.attach) pushPart(o.attach, 'attachment')
  lines.push(`--${boundary}--`)
  return Buffer.from(lines.join('\r\n'))
}

let root: string
const tmpRoot = () => root

describe('extractAttachments', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attextract-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('解析出 inline(含 cid) 与 attachment 两类,逐个落盘 + 记表', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true })
    const raw = buildMime({
      inline: { filename: 'logo.png', cid: 'img1', mime: 'image/png', data: Buffer.from([1, 2, 3]) },
      attach: { filename: 'doc.pdf', mime: 'application/pdf', data: Buffer.from([4, 5, 6]) },
    })
    const result = await extractAttachments(raw, { accountId: 1, messageId: 1, root: tmpRoot(), db: memDb(), scan: scan as any })
    expect(result).toHaveLength(2)
    expect(result.find((a) => a.contentId)).toMatchObject({
      filename: 'logo.png',
      isInline: true,
      contentId: '<img1>',
    })
    expect(result.find((a) => !a.contentId)).toMatchObject({ filename: 'doc.pdf', isInline: false })
    expect(scan).toHaveBeenCalledTimes(2) // 钩子对每(落盘)附件调用
  })

  it('超 perAttachment 上限的附件跳过落盘但记表(size 标记、storagePath 空)', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024)
    const raw = buildMime({
      attach: { filename: 'big.bin', mime: 'application/octet-stream', data: big },
    })
    const result = await extractAttachments(raw, {
      accountId: 1,
      messageId: 1,
      root: tmpRoot(),
      db: memDb(),
      limits: { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 },
    })
    expect(result[0].storagePath).toBeNull()
    expect(result[0].size).toBe(big.length)
    expect(result[0].overSizeLimit).toBe(true)
  })

  it('scan 钩子返回 ok:false → 标记 flagged 但不阻断', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: false, reason: 'EICAR' })
    const raw = buildMime({
      attach: { filename: 'x.txt', mime: 'text/plain', data: Buffer.from('z') },
    })
    const result = await extractAttachments(raw, { accountId: 1, messageId: 1, root: tmpRoot(), db: memDb(), scan: scan as any })
    expect(result[0].scanStatus).toBe('flagged')
    expect(result[0].scanReason).toBe('EICAR')
  })

  it('落盘附件可在磁盘找到 + sha256 写表', async () => {
    const data = Buffer.from([7, 8, 9])
    const raw = buildMime({ attach: { filename: 'a.bin', mime: 'application/octet-stream', data } })
    const result = await extractAttachments(raw, { accountId: 2, messageId: 5, root: tmpRoot(), db: memDb() })
    expect(result[0].storagePath).toContain('attachments/2/5/')
    expect(fs.existsSync(path.join(tmpRoot(), result[0].storagePath!))).toBe(true)
    expect(result[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
