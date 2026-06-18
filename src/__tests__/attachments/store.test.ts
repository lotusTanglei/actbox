// src/__tests__/attachments/store.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { storeContent, resolveSafePath, releaseByMessage, readStream } from '@/lib/attachments/store'
import { memDb } from '../helpers/memDb'

let root: string
const tmpRoot = () => root

describe('附件落盘 store', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attstore-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('resolveSafePath 拒绝路径穿越', () => {
    expect(() => resolveSafePath(tmpRoot(), { accountId: 1, messageId: 1, sha256: '../../etc/x' })).toThrow(
      /traversal|escape/i,
    )
  })

  it('storeContent 按 sha256 落盘并返回相对路径(含 messageId 段)', async () => {
    const buf = Buffer.from('hello')
    const p1 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 1 })
    const p2 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 2 })
    expect(p1).toContain('attachments/1/1/')
    expect(p1.endsWith('.bin')).toBe(true)
    expect(p2).toContain('attachments/1/2/')
    expect(fs.existsSync(path.join(tmpRoot(), p1))).toBe(true)
  })

  it('相同内容同消息不重写(路径相同)', async () => {
    const buf = Buffer.from('hello')
    const p1 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 1 })
    const p2 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 1 })
    expect(p1).toBe(p2)
  })

  it('readStream 读回落盘内容', async () => {
    const buf = Buffer.from('hello world')
    const rel = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 1 })
    const chunks: Buffer[] = []
    for await (const c of readStream(tmpRoot(), rel)) chunks.push(c as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('hello world')
  })

  it('readStream 拒绝路径穿越', () => {
    expect(() => readStream(tmpRoot(), '../../etc/passwd')).toThrow(/traversal|escape/i)
  })

  it('releaseByMessage 删行 + unlink 独占文件', async () => {
    const db = memDb()
    const rel = await storeContent(tmpRoot(), Buffer.from('a'), { accountId: 1, messageId: 1 })
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO messages (message_id, account_id, folder, direction, processed_at) VALUES ('<m1>',1,'INBOX','in',?)`,
    ).run(now)
    db.prepare(
      `INSERT INTO attachments (account_id, message_id, filename, size, storage_path, sha256, downloaded_at) VALUES (1,1,'a.txt',1,?,?,?)`,
    ).run(rel, 'sha-a', now)

    expect(fs.existsSync(path.join(tmpRoot(), rel))).toBe(true)
    const stats = await releaseByMessage(db, tmpRoot(), 1)
    expect(stats.filesDeleted).toBe(1)
    expect(stats.released).toBe(1)
    expect(fs.existsSync(path.join(tmpRoot(), rel))).toBe(false)
    const { c } = db.prepare('SELECT COUNT(*) c FROM attachments WHERE message_id=1').get() as { c: number }
    expect(c).toBe(0)
  })

  it('releaseByMessage：文件被同消息多行共享时不误删(先全删行再 unlink)', async () => {
    const db = memDb()
    const rel = await storeContent(tmpRoot(), Buffer.from('shared'), { accountId: 1, messageId: 1 })
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      `INSERT INTO messages (message_id, account_id, folder, direction, processed_at) VALUES ('<m1>',1,'INBOX','in',?)`,
    ).run(now)
    // 两行指向同一 storagePath(同消息重复附件 → 一个文件)
    db.prepare(
      `INSERT INTO attachments (account_id, message_id, filename, size, storage_path, sha256, downloaded_at) VALUES (1,1,'a.txt',6,?,?,?),(1,1,'a.txt',6,?,?,?)`,
    ).run(rel, 'sha-a', now, rel, 'sha-a', now)

    const stats = await releaseByMessage(db, tmpRoot(), 1)
    expect(stats.released).toBe(2) // 两行都删
    expect(stats.filesDeleted).toBe(1) // 一个文件
  })
})
