// src/lib/db/index.ts

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'
import { alignBaseline, migrate } from './migrate-runner'

let _db: ReturnType<typeof drizzle> | null = null
let _raw: Database.Database | null = null

/**
 * 获取 Drizzle 实例（单例）。
 * 首次创建时：对齐存量库基准 + 跑 drizzle migrate。
 * - 空库：migrate 从零建出全表。
 * - 存量旧库（从前的 autoCreateTables 建过表、无 drizzle 历史）：align 种 baseline，
 *   migrate 跳过 0000、只跑增量（0001+），旧数据不丢。
 */
export function getDb() {
  if (_db) return _db

  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'actbox.db')
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')

  _raw = sqlite
  _db = drizzle(sqlite, { schema })

  const migrationsFolder = path.join(process.cwd(), 'drizzle')
  if (fs.existsSync(migrationsFolder)) {
    alignBaseline(sqlite, { migrationsFolder })
    migrate(_db, { migrationsFolder })
  }

  return _db
}

/** 原生 better-sqlite3 实例(供 raw SQL 模块:folders/sync/writeback 用)。 */
export function getRawDb(): Database.Database {
  getDb()
  return _raw!
}

/** 重置 DB 实例（测试用） */
export function resetDb() {
  _db = null
}
