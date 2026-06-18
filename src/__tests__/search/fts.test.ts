// src/__tests__/search/fts.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import { runFtsMigrate, registerSegmentFunction } from '@/lib/db/fts-migrate'
import { parseQuery } from '@/lib/search/query-parser'
import { searchMessages } from '@/lib/search/fts'

const tmp = () => `./data/test-fts-q-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`

describe('searchMessages', () => {
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
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder, received_at, is_read)
             VALUES ('<a1>','季度报告','boss@acme.com','me@x.com','Q1 收入增长 发票','报告正文',1,'INBOX',1700000000,0),
                    ('<a2>','闲聊','friend@x.com','me@x.com','周末有空吗','hi',2,'INBOX',1700001000,1),
                    ('<a3>','季度报告2','boss@acme.com','other@x.com','Q2','报告',1,'Sent',1700002000,1)`)
  })
  afterEach(() => {
    db.close()
    try {
      fs.unlinkSync(path)
    } catch {
      /* ignore */
    }
  })

  it('freeText 全文命中跨文件夹跨账号', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'relevance' })
    expect(r.map((x) => x.messageId).sort()).toEqual(['<a1>', '<a3>'].sort())
  })

  it('from: 限定发件人', () => {
    const r = searchMessages(db, parseQuery('报告 from:boss'), { sort: 'relevance' })
    expect(r.map((x) => x.messageId).sort()).toEqual(['<a1>', '<a3>'].sort())
  })

  it('from: + 账号/文件夹二次过滤', () => {
    const r = searchMessages(db, parseQuery('from:boss'), { accountId: 1, folder: 'INBOX' })
    expect(r.map((x) => x.messageId)).toEqual(['<a1>'])
  })

  it('is:unread 过滤', () => {
    const r = searchMessages(db, parseQuery('is:unread'))
    expect(r.map((x) => x.messageId)).toEqual(['<a1>'])
  })

  it('after:/before: 时间过滤', () => {
    const r = searchMessages(db, parseQuery('after:2023-01-01 before:2023-12-31'))
    expect(r.length).toBe(3)
  })

  it('sort=time 按时间倒序', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'time' })
    expect(r[0].messageId).toBe('<a3>')
  })

  it('sort=sender 按发件人', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'sender' })
    expect(r.length).toBe(2)
  })

  it('空查询返回全量(受 is_deleted 过滤)', () => {
    const r = searchMessages(db, parseQuery(''), { sort: 'time' })
    expect(r.length).toBe(3)
  })
})
