// src/__tests__/db/backfill.test.ts
// 验证 body 全文回填：疑似截断行被回填、幂等、dryRun 不写库、fetchSource 返回 null 跳过。

import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import { runBackfill } from '@/lib/db/backfill-runner'

const tmp = () =>
  `./data/test-backfill-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
let dbPath: string

function makeDb() {
  dbPath = tmp()
  fs.mkdirSync('./data', { recursive: true })
  const db = new Database(dbPath)
  db.exec(
    'CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, account_id INTEGER, body TEXT, body_html TEXT, imap_uid INTEGER)',
  )
  db.exec(
    `INSERT INTO messages (message_id, account_id, body) VALUES ('<m1>', 1, '${'x'.repeat(300)}')`,
  )
  return db
}

describe('backfill 全文回填', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(dbPath)
    } catch {
      /* ignore */
    }
  })

  it('疑似截断行被回填；第二次跑幂等（refilled=0）', async () => {
    const db = makeDb()
    const fetchSource = vi
      .fn()
      .mockResolvedValue({ body: 'y'.repeat(800), bodyHtml: '<p>full</p>', imapUid: 42 })

    const stats = await runBackfill({ db, fetchSource, dryRun: false })
    expect(stats.refilled).toBe(1)
    expect(fetchSource).toHaveBeenCalledTimes(1)

    const row = db.prepare("SELECT body, body_html, imap_uid FROM messages WHERE message_id='<m1>'").get() as {
      body: string
      body_html: string
      imap_uid: number
    }
    expect(row.body).toBe('y'.repeat(800))
    expect(row.body_html).toBe('<p>full</p>')
    expect(row.imap_uid).toBe(42)

    // 第二次：body 已 800 > 500，不再是候选 → refilled=0
    const stats2 = await runBackfill({ db, fetchSource, dryRun: false })
    expect(stats2.refilled).toBe(0)
    db.close()
  })

  it('fetchSource 返回 null → skip，不写库', async () => {
    const db = makeDb()
    const fetchSource = vi.fn().mockResolvedValue(null)
    const stats = await runBackfill({ db, fetchSource, dryRun: false })
    expect(stats.refilled).toBe(0)
    expect(stats.skipped).toBe(1)
    const row = db.prepare("SELECT body FROM messages WHERE message_id='<m1>'").get() as { body: string }
    expect(row.body).toBe('x'.repeat(300)) // 未改
    db.close()
  })

  it('dryRun：计数但不写库', async () => {
    const db = makeDb()
    const fetchSource = vi.fn().mockResolvedValue({ body: 'y'.repeat(800), imapUid: 42 })
    const stats = await runBackfill({ db, fetchSource, dryRun: true })
    expect(stats.refilled).toBe(1)
    const row = db.prepare("SELECT body FROM messages WHERE message_id='<m1>'").get() as { body: string }
    expect(row.body).toBe('x'.repeat(300)) // dryRun 不改
    db.close()
  })
})
