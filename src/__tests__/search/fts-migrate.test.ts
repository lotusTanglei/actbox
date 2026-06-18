// src/__tests__/search/fts-migrate.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import { runFtsMigrate, registerSegmentFunction } from '@/lib/db/fts-migrate'

const tmp = () => `./data/test-fts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`

describe('FTS5 迁移', () => {
  let path: string
  let db: Database.Database
  beforeEach(() => {
    fs.mkdirSync('./data', { recursive: true })
    path = tmp()
    db = new Database(path)
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY, message_id TEXT UNIQUE, subject TEXT, sender TEXT,
      "to" TEXT, body TEXT, body_html_text TEXT, account_id INTEGER, folder TEXT,
      received_at INTEGER, is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0
    )`)
  })
  afterEach(() => {
    db.close()
    try {
      fs.unlinkSync(path)
    } catch {
      /* ignore */
    }
  })

  it('建出 messages_fts 虚表 + 三组触发器(幂等二次执行不报错)', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'").get(),
    ).toBeTruthy()
    const trigs = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='messages'")
      .all() as { name: string }[]
    expect(trigs.map((t) => t.name).sort()).toEqual(
      ['messages_fts_ai', 'messages_fts_ad', 'messages_fts_au'].sort(),
    )
    expect(() => runFtsMigrate(db)).not.toThrow() // 幂等
  })

  it('INSERT messages → 触发器自动写 FTS;MATCH 命中中文', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder)
             VALUES ('<m1>', '发票报销', 'boss@x.com', 'me@x.com', '请尽快处理发票', '正文报销单', 1, 'INBOX')`)
    const hit = db
      .prepare(
        `SELECT m.message_id FROM messages_fts f JOIN messages m ON m.id = f.rowid
         WHERE messages_fts MATCH ? ORDER BY bm25(messages_fts) LIMIT 10`,
      )
      .all('发票') as { message_id: string }[]
    expect(hit.map((h) => h.message_id)).toContain('<m1>')
  })

  it('UPDATE messages.subject → FTS 同步新值', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(
      `INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder) VALUES ('<m2>', '旧主题', 'a@x', 'b@x', '', '', 1, 'INBOX')`,
    )
    db.exec(`UPDATE messages SET subject='全新主题' WHERE message_id='<m2>'`)
    const old = db
      .prepare(
        "SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '旧主题'",
      )
      .get()
    expect(old).toBeUndefined()
    const neu = db
      .prepare(
        "SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '全新主题'",
      )
      .get()
    expect(neu).toBeTruthy()
  })

  it('DELETE messages → FTS 行清除', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(
      `INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder) VALUES ('<m3>', '删除测试', 'a@x', 'b@x', '', '', 1, 'INBOX')`,
    )
    db.exec(`DELETE FROM messages WHERE message_id='<m3>'`)
    const hit = db
      .prepare(
        "SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '删除测试'",
      )
      .get()
    expect(hit).toBeUndefined()
  })

  it('存量回填:迁移前已有的 messages 经 JS 分词回填进 FTS', () => {
    db.exec(
      `INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder) VALUES ('<m4>', '历史发票', 'a@x', 'b@x', '历史报销', '', 1, 'INBOX')`,
    )
    runFtsMigrate(db) // 回填
    const hit = db
      .prepare(
        "SELECT m.message_id FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '发票'",
      )
      .all() as { message_id: string }[]
    expect(hit.map((h) => h.message_id)).toContain('<m4>')
  })
})
