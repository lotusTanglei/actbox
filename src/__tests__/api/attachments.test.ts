// src/__tests__/api/attachments.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ db: null as ReturnType<typeof memDb> | null, root: '' }))

vi.mock('@/lib/db', () => ({ getDb: () => refs.db, getRawDb: () => refs.db }))
vi.mock('@/lib/attachments/store', () => ({
  getAttachmentsRoot: () => refs.root,
  // 真实读取(从受控 root),忽略传入 root
  readStream: (_root: string, storagePath: string) => fs.createReadStream(path.resolve(refs.root, storagePath)),
  resolveSafePath: (_root: string, o: { accountId: number; messageId: number; sha256: string }) =>
    path.join('attachments', String(o.accountId), String(o.messageId), `${o.sha256}.bin`),
}))

import { GET as listGet } from '@/app/api/messages/[id]/attachments/route'
import { GET as dlGet } from '@/app/api/messages/[id]/attachments/[aid]/route'

const NOW = Math.floor(Date.now() / 1000)

function seed(db: ReturnType<typeof memDb>) {
  db.prepare(
    `INSERT INTO messages (id, message_id, account_id, folder, direction, processed_at) VALUES (5,'<m5>',1,'INBOX','in',?)`,
  ).run(NOW)
  db.prepare(
    `INSERT INTO attachments (id, account_id, message_id, filename, mime_type, size, content_id, is_inline, storage_path, sha256, downloaded_at)
     VALUES
       (9,1,5,'doc.pdf','application/pdf',123,NULL,0,'attachments/1/5/sha1.bin','sha1',?),
       (10,1,5,'logo.png','image/png',9,'<img1>',1,'attachments/1/5/sha2.bin','sha2',?),
       (11,1,5,'big.bin','application/octet-stream',27262976,NULL,0,NULL,NULL,?),
       (12,1,5,'报告.pdf','application/pdf',50,NULL,0,'attachments/1/5/sha3.bin','sha3',?)`,
  ).run(NOW, NOW, NOW, NOW)
}

const ctxId = (id: string) => ({ params: Promise.resolve({ id }) })
const ctxAid = (id: string, aid: string) => ({ params: Promise.resolve({ id, aid }) })

describe('附件 API', () => {
  let root: string
  beforeEach(() => {
    refs.db = memDb()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attapi-'))
    refs.root = root
    seed(refs.db!)
    fs.mkdirSync(path.join(root, 'attachments/1/5'), { recursive: true })
    fs.writeFileSync(path.join(root, 'attachments/1/5/sha1.bin'), 'PDF-CONTENT')
    fs.writeFileSync(path.join(root, 'attachments/1/5/sha2.bin'), Buffer.from([1, 2, 3]))
    fs.writeFileSync(path.join(root, 'attachments/1/5/sha3.bin'), 'CN-CONTENT')
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('GET /api/messages/5/attachments → 列表', async () => {
    const res = await listGet(new NextRequest('http://localhost/api/messages/5/attachments'), ctxId('5'))
    expect(res.status).toBe(200)
    const data = await res.json()
    const names = data.attachments.map((a: { filename: string }) => a.filename)
    expect(names).toEqual(expect.arrayContaining(['doc.pdf', 'logo.png', 'big.bin', '报告.pdf']))
  })

  it('GET /api/messages/5/attachments/9 → 强制 attachment 下载 + 正确 Content-Type + body', async () => {
    const res = await dlGet(
      new NextRequest('http://localhost/api/messages/5/attachments/9'),
      ctxAid('5', '9'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const cd = res.headers.get('content-disposition') || ''
    expect(cd).toContain('attachment')
    expect(cd).toContain('doc.pdf')
    expect(await res.text()).toBe('PDF-CONTENT')
  })

  it('?inline=1 → Content-Disposition: inline', async () => {
    const res = await dlGet(
      new NextRequest('http://localhost/api/messages/5/attachments/9?inline=1'),
      ctxAid('5', '9'),
    )
    expect(res.headers.get('content-disposition')).toMatch(/inline/)
  })

  it('超限未落盘(storagePath 空)→ 404 not_downloaded', async () => {
    const res = await dlGet(
      new NextRequest('http://localhost/api/messages/5/attachments/11'),
      ctxAid('5', '11'),
    )
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('not_downloaded')
  })

  it('非 ASCII 文件名 → RFC5987 filename*', async () => {
    const res = await dlGet(
      new NextRequest('http://localhost/api/messages/5/attachments/12'),
      ctxAid('5', '12'),
    )
    const cd = res.headers.get('content-disposition') || ''
    expect(cd).toMatch(/filename\*=UTF-8''/)
  })

  it('aid 不属于该消息 → 404', async () => {
    const res = await dlGet(
      new NextRequest('http://localhost/api/messages/999/attachments/9'),
      ctxAid('999', '9'),
    )
    expect(res.status).toBe(404)
  })
})
