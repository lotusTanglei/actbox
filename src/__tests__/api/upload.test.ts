// src/__tests__/api/upload.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

const refs = vi.hoisted(() => ({ root: '' }))

vi.mock('@/lib/attachments/store', () => ({
  getAttachmentsRoot: () => refs.root,
  storeTmpContent: async (_root: string, buf: Buffer) => {
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    const rel = path.join('attachments', 'tmp', `${sha}.bin`)
    fs.mkdirSync(path.join(refs.root, 'attachments', 'tmp'), { recursive: true })
    fs.writeFileSync(path.join(refs.root, rel), buf)
    return { storagePath: rel, sha256: sha }
  },
}))

import { POST } from '@/app/api/upload/route'

function upload(file: { name: string; type: string; data: Buffer }, extra?: Record<string, string>) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(file.data)], file.name, { type: file.type }) as unknown as Blob)
  if (extra) for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form })
}

describe('POST /api/upload', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attupload-'))
    refs.root = root
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('上传成功 → 返回元数据 + 落盘 tmp', async () => {
    const data = Buffer.from('hello-upload')
    const res = await POST(upload({ name: 'doc.pdf', type: 'application/pdf', data }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ filename: 'doc.pdf', size: data.length, mimeType: 'application/pdf' })
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(body.storagePath).toContain('attachments/tmp/')
    expect(fs.existsSync(path.join(root, body.storagePath))).toBe(true)
    expect(body.sha256).toBe(crypto.createHash('sha256').update(data).digest('hex'))
  })

  it('超 perAttachment(25MB) → 413', async () => {
    const big = Buffer.alloc(25 * 1024 * 1024 + 1)
    const res = await POST(upload({ name: 'big.bin', type: 'application/octet-stream', data: big }))
    expect(res.status).toBe(413)
  })

  it('filename 含 ../ → 清洗为 basename', async () => {
    const res = await POST(upload({ name: '../../../etc/passwd', type: 'text/plain', data: Buffer.from('x') }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.filename).toBe('passwd')
  })

  it('inline=1 → 返回 cid', async () => {
    const res = await POST(
      upload({ name: 'shot.png', type: 'image/png', data: Buffer.from([1]) }, { inline: '1' }),
    )
    const body = await res.json()
    expect(body.cid).toBeTruthy()
  })

  it('未提供 file → 400', async () => {
    const form = new FormData()
    const res = await POST(new NextRequest('http://localhost/api/upload', { method: 'POST', body: form }))
    expect(res.status).toBe(400)
  })
})
