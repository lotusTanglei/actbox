// scripts/align-baseline.ts — 仅做存量库基准对齐（供排查/单独执行）。
// 用法：npx tsx scripts/align-baseline.ts
import Database from 'better-sqlite3'
import { alignBaselineRaw } from '../src/lib/db/align-baseline'

const raw = new Database(process.env.ACTBOX_DB || './data/actbox.db')
console.log('[align-baseline]', JSON.stringify(alignBaselineRaw(raw, { migrationsFolder: './drizzle' })))
raw.close()
