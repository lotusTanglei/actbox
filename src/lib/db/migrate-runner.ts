// src/lib/db/migrate-runner.ts
// migrate / alignBaseline 的薄封装，供 getDb() 与 scripts/migrate.ts 复用。
// 注意：alignBaseline 操作原生 better-sqlite3 Database；migrate 操作 drizzle 实例。

import type Database from 'better-sqlite3'
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import { alignBaselineRaw, type AlignResult } from './align-baseline'

export function alignBaseline(db: Database.Database, opts: { migrationsFolder: string }): AlignResult {
  return alignBaselineRaw(db, opts)
}

export function migrate(db: unknown, opts: { migrationsFolder: string }) {
  // db 为 drizzle 实例（含 .dialect/.session）；drizzleMigrate 内部调用 db.dialect.migrate。
  drizzleMigrate(db as Parameters<typeof drizzleMigrate>[0], opts)
}
