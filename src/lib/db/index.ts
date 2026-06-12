// src/lib/db/index.ts

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

let _db: ReturnType<typeof drizzle> | null = null

/** 获取 Drizzle 实例（单例） */
export function getDb() {
  if (_db) return _db

  // 确保 data 目录存在
  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'actbox.db')
  const sqlite = new Database(dbPath)

  // 启用 WAL 模式提升并发性能
  sqlite.pragma('journal_mode = WAL')

  _db = drizzle(sqlite, { schema })

  // 自动建表（首次运行）
  autoCreateTables(sqlite)

  return _db
}

/** 自动建表（首次运行） */
function autoCreateTables(sqlite: Database.Database) {
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
    .get()

  if (!tableExists) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due_date TEXT,
        priority TEXT CHECK(priority IN ('high', 'medium', 'low')),
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
        source_message_id TEXT,
        source_subject TEXT,
        source_from TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        subject TEXT,
        sender TEXT,
        body TEXT,
        received_at INTEGER,
        processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        direction TEXT NOT NULL DEFAULT 'in' CHECK(direction IN ('in', 'out'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
    `)
  }
}

/** 重置 DB 实例（测试用） */
export function resetDb() {
  _db = null
}
