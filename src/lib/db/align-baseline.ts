// src/lib/db/align-baseline.ts
// 存量库基准对齐。
// 背景：actbox 旧库由从前的 autoCreateTables 建表，没有 drizzle 迁移历史。drizzle
// migrate() 对这种“表已存在、无 __drizzle_migrations”的库会执行 0000 的 CREATE TABLE
// 而报错。本函数在 migrate 之前：若检测到 “messages 表已存在但 __drizzle_migrations
// 为空”，把 baseline（0000，引入 drizzle 时的 schema 快照）种入迁移记录，使 migrate
// 跳过 0000、只应用后续增量（0001+）。
//
// 判定依据：drizzle migrate 按 folderMillis（journal 的 when）时间戳比较决定应用与否
// （取 __drizzle_migrations 中 created_at 最大者，应用所有 folderMillis 更大的迁移），
// 非按 hash 匹配。故种入 baseline 时 created_at = baseline.when 即可让其被跳过。

import type Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

interface JournalEntry {
  tag: string
  when: number
}
interface Journal {
  entries: JournalEntry[]
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
  return !!row
}

function readJournal(migrationsFolder: string): Journal {
  return JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'))
}

export interface AlignResult {
  seeded: boolean
  reason: string
  tag?: string
}

/**
 * 对齐存量库基准。幂等：只在“有数据表但无迁移历史”时种 baseline 一次。
 * 空库（无 messages 表）→ 不动，交给 migrate 从零建。
 * 已有迁移历史 → 不动。
 */
export function alignBaselineRaw(db: Database.Database, opts: { migrationsFolder: string }): AlignResult {
  const journal = readJournal(opts.migrationsFolder)
  if (!journal.entries?.length) return { seeded: false, reason: 'no migrations in journal' }

  // 空库：无 legacy 表，交给 migrate 从零建。
  if (!tableExists(db, 'messages')) return { seeded: false, reason: 'fresh db (no legacy tables)' }

  // 已有迁移历史：无需对齐。
  if (tableExists(db, '__drizzle_migrations')) {
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }
    if (c > 0) return { seeded: false, reason: 'already has migration history' }
  }

  // 存量库：种 baseline（0000）为已应用。
  const baseline = journal.entries[0]
  const sql = fs.readFileSync(path.join(opts.migrationsFolder, `${baseline.tag}.sql`), 'utf8')
  const hash = crypto.createHash('sha256').update(sql).digest('hex')

  db.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at numeric)',
  )
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations WHERE hash=?').get(hash) as { c: number }
  if (c === 0) {
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, baseline.when)
  }
  return { seeded: true, reason: 'legacy db aligned', tag: baseline.tag }
}
