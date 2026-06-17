// src/__tests__/adapter/registry.test.ts
// adapterRegistry：按 accountId 取配置/适配器（用内存库注入 db）。

import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { accounts } from '@/lib/db/schema'
import { alignBaseline, migrate } from '@/lib/db/migrate-runner'
import { getAccountConfig, getAdapter, listActiveAccountIds } from '@/lib/adapter/mail/adapterRegistry'

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any

beforeAll(() => {
  const raw = Database(':memory:')
  db = drizzle(raw, { schema })
  alignBaseline(raw, { migrationsFolder: './drizzle' })
  migrate(db, { migrationsFolder: './drizzle' })
})

function seedAccount(email: string) {
  const [row] = db
    .insert(accounts)
    .values({
      email,
      provider: '163',
      user: email,
      authCode: 'pw',
      imapHost: 'imap.163.com',
      imapPort: 993,
      smtpHost: 'smtp.163.com',
      smtpPort: 465,
    })
    .returning()
    .all()
  return row
}

describe('adapterRegistry', () => {
  it('getAccountConfig 取出并正确映射', () => {
    const row = seedAccount('t1@163.com')
    const cfg = getAccountConfig(row.id, db)
    expect(cfg).not.toBeNull()
    expect(cfg!.email).toBe('t1@163.com')
    expect(cfg!.imapHost).toBe('imap.163.com')
    expect(cfg!.authCode).toBe('pw')
  })

  it('getAdapter 返回带 testConnection 的适配器', () => {
    const row = seedAccount('t2@163.com')
    const a = getAdapter(row.id, { db })
    expect(a).not.toBeNull()
    expect(typeof a!.testConnection).toBe('function')
    expect(typeof a!.fetch).toBe('function')
  })

  it('listActiveAccountIds 只列启用账号', () => {
    const ids = listActiveAccountIds(db)
    expect(ids.length).toBeGreaterThanOrEqual(2)
  })

  it('不存在返回 null', () => {
    expect(getAccountConfig(99999, db)).toBeNull()
    expect(getAdapter(99999, { db })).toBeNull()
  })
})
