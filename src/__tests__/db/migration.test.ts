// src/__tests__/db/migration.test.ts
// 验证迁移机制：空库从零建表；存量库（表已存在无迁移历史）对齐后 migrate 不重建表、不丢数据。
// 注：account_id 等新列由 plan-01 Task 3（0001 增量迁移）加入，本测试只验证机制。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import fs from 'fs'
import { alignBaseline, migrate } from '@/lib/db/migrate-runner'

const tmp = () =>
  `./data/test-migrate-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`

describe('schema 迁移 + 存量库基准对齐', () => {
  let dbPath: string
  beforeEach(() => {
    fs.mkdirSync('./data', { recursive: true })
    dbPath = tmp()
  })
  afterEach(() => {
    try {
      fs.unlinkSync(dbPath)
    } catch {
      /* ignore */
    }
  })

  it('空库：align 跳过，migrate 从零建出基线表 + 记录迁移', () => {
    const raw = new Database(dbPath)
    const ddb = drizzle(raw)

    const align = alignBaseline(raw, { migrationsFolder: './drizzle' })
    expect(align.seeded).toBe(false) // 空库不对齐

    migrate(ddb, { migrationsFolder: './drizzle' })

    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['messages', 'todos', 'settings', '__drizzle_migrations']),
    )
    const { c } = raw.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }
    expect(c).toBeGreaterThanOrEqual(1)
    raw.close()
  })

  it('存量旧库（messages 已存在 + 一行数据）：align 种 baseline，migrate 不重建表、不丢数据', () => {
    const raw = new Database(dbPath)
    raw.exec(
      'CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT, body TEXT, direction TEXT)',
    )
    raw.exec(
      `INSERT INTO messages (message_id, body, direction) VALUES ('<m1>', '${'x'.repeat(300)}', 'in')`,
    )
    const ddb = drizzle(raw)

    const align = alignBaseline(raw, { migrationsFolder: './drizzle' })
    expect(align.seeded).toBe(true)

    // migrate 不应因 CREATE TABLE messages 已存在而抛错
    expect(() => migrate(ddb, { migrationsFolder: './drizzle' })).not.toThrow()

    // 旧数据保留
    const row = raw.prepare("SELECT body FROM messages WHERE message_id='<m1>'").get() as { body: string }
    expect(row.body).toBe('x'.repeat(300))

    // baseline 已记录
    const { c } = raw.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }
    expect(c).toBeGreaterThanOrEqual(1)
    raw.close()
  })

  it('幂等：对同一存量库重复 align 不重复种入', () => {
    const raw = new Database(dbPath)
    raw.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT)')
    alignBaseline(raw, { migrationsFolder: './drizzle' })
    const { c: c1 } = raw.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }
    alignBaseline(raw, { migrationsFolder: './drizzle' })
    const { c: c2 } = raw.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }
    expect(c2).toBe(c1) // 第二次不再种
    raw.close()
  })
})
