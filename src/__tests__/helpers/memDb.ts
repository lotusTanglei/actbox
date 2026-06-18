// src/__tests__/helpers/memDb.ts
// 内存库助手:返回已跑全量迁移的 raw better-sqlite3 Database(供 plan-03 同步/回写测试)。
// 直接用 .prepare/.exec/.run 做断言与种子。

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { alignBaseline, migrate } from '@/lib/db/migrate-runner'

export function memDb(): Database.Database {
  const raw = Database(':memory:')
  const db = drizzle(raw, { schema })
  alignBaseline(raw, { migrationsFolder: './drizzle' })
  migrate(db, { migrationsFolder: './drizzle' })
  return raw
}
