// src/__tests__/attachments/repo.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { listByMessage, getById, countBySha256, markScanFlag, releaseByMessage } from '@/lib/attachments/repo'
import { storeContent } from '@/lib/attachments/store'
import { memDb } from '../helpers/memDb'

let root: string
const tmpRoot = () => root
const NOW = Math.floor(Date.now() / 1000)

function seedMsg(db: ReturnType<typeof memDb>, id: number, acc = 1) {
  db.prepare(
    `INSERT INTO messages (message_id, account_id, folder, direction, processed_at) VALUES (?,?,?,?,?)`,
  ).run(`<m${id}>`, acc, 'INBOX', 'in', NOW)
}
function seedAtt(
  db: ReturnType<typeof memDb>,
  o: { mid: number; filename: string; sha: string; storagePath: string | null; inline?: boolean; cid?: string | null },
) {
  db.prepare(
    `INSERT INTO attachments (account_id, message_id, filename, size, sha256, storage_path, is_inline, content_id, downloaded_at)
     VALUES (1,?,?,?,?,?,?,?,?)`,
  ).run(o.mid, o.filename, 1, o.sha, o.storagePath, o.inline ? 1 : 0, o.cid ?? null, NOW)
}

describe('attachments repo', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attrepo-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('listByMessage 返回行(inline/contentId/bool 映射)', () => {
    const db = memDb()
    seedMsg(db, 1)
    seedAtt(db, { mid: 1, filename: 'logo.png', sha: 's1', storagePath: 'attachments/1/1/s1.bin', inline: true, cid: '<img1>' })
    seedAtt(db, { mid: 1, filename: 'doc.pdf', sha: 's2', storagePath: 'attachments/1/1/s2.bin' })
    const rows = listByMessage(db, 1)
    expect(rows).toHaveLength(2)
    const inline = rows.find((r) => r.isInline)
    expect(inline).toMatchObject({ filename: 'logo.png', contentId: '<img1>', isInline: true })
    const file = rows.find((r) => !r.isInline)
    expect(file).toMatchObject({ filename: 'doc.pdf', contentId: null, isInline: false })
  })

  it('listByMessage 只返回该消息(隔离)', () => {
    const db = memDb()
    seedMsg(db, 1)
    seedMsg(db, 2)
    seedAtt(db, { mid: 1, filename: 'a.txt', sha: 's1', storagePath: 'attachments/1/1/s1.bin' })
    seedAtt(db, { mid: 2, filename: 'b.txt', sha: 's2', storagePath: 'attachments/1/2/s2.bin' })
    expect(listByMessage(db, 1)).toHaveLength(1)
    expect(listByMessage(db, 1)[0].filename).toBe('a.txt')
  })

  it('getById', () => {
    const db = memDb()
    seedMsg(db, 1)
    seedAtt(db, { mid: 1, filename: 'a.txt', sha: 's1', storagePath: 'attachments/1/1/s1.bin' })
    const list = listByMessage(db, 1)
    const got = getById(db, list[0].id)
    expect(got).toMatchObject({ filename: 'a.txt' })
    expect(getById(db, 99999)).toBeNull()
  })

  it('countBySha256', () => {
    const db = memDb()
    seedMsg(db, 1)
    seedMsg(db, 2)
    seedAtt(db, { mid: 1, filename: 'a.txt', sha: 'shared', storagePath: 'attachments/1/1/shared.bin' })
    seedAtt(db, { mid: 2, filename: 'a.txt', sha: 'shared', storagePath: 'attachments/1/2/shared.bin' })
    expect(countBySha256(db, 'shared')).toBe(2)
    expect(countBySha256(db, 'none')).toBe(0)
  })

  it('markScanFlag 置 flagged + reason', () => {
    const db = memDb()
    seedMsg(db, 1)
    seedAtt(db, { mid: 1, filename: 'x', sha: 's1', storagePath: 'attachments/1/1/s1.bin' })
    const id = listByMessage(db, 1)[0].id
    markScanFlag(db, id, 'EICAR')
    expect(getById(db, id)).toMatchObject({ scanStatus: 'flagged', scanReason: 'EICAR' })
  })

  it('releaseByMessage 删行 + 仅删该消息独占文件(同 sha 跨消息互不影响)', async () => {
    const db = memDb()
    seedMsg(db, 1)
    seedMsg(db, 2)
    // 同内容,per-message 不同物理文件
    const p1 = await storeContent(tmpRoot(), Buffer.from('same'), { accountId: 1, messageId: 1 })
    const p2 = await storeContent(tmpRoot(), Buffer.from('same'), { accountId: 1, messageId: 2 })
    seedAtt(db, { mid: 1, filename: 'a.txt', sha: 'shared', storagePath: p1 })
    seedAtt(db, { mid: 2, filename: 'a.txt', sha: 'shared', storagePath: p2 })

    expect(fs.existsSync(path.join(tmpRoot(), p1))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot(), p2))).toBe(true)

    const stats = await releaseByMessage(db, tmpRoot(), 1)
    expect(stats.released).toBe(1)
    expect(stats.filesDeleted).toBe(1)
    expect(fs.existsSync(path.join(tmpRoot(), p1))).toBe(false) // msg1 文件删
    expect(fs.existsSync(path.join(tmpRoot(), p2))).toBe(true) // msg2 文件保留
  })
})
