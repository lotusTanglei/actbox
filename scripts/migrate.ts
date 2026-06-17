// scripts/migrate.ts — 迁移 CLI：对齐存量库基准 + 跑 drizzle migrate。
// 用法：npm run db:migrate  （或 ACTBOX_DB=./path npm run db:migrate）
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import fs from 'fs'
import * as schema from '../src/lib/db/schema'
import { alignBaseline, migrate } from '../src/lib/db/migrate-runner'

const dbPath = process.env.ACTBOX_DB || './data/actbox.db'
const migrationsFolder = './drizzle'

fs.mkdirSync('./data', { recursive: true })
const raw = new Database(dbPath)
raw.pragma('journal_mode = WAL')

const ddb = drizzle(raw, { schema })
const align = alignBaseline(raw, { migrationsFolder })
migrate(ddb, { migrationsFolder })

console.log('[migrate] align:', JSON.stringify(align), '→ migrations applied')
raw.close()
