// src/__tests__/adapter/registry.test.ts
// adapterRegistry：按 accountId 取配置/适配器（用内存库注入 db）+ env 引导建默认账号。

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { alignBaseline, migrate } from '@/lib/db/migrate-runner'
import { getAccountConfig, getAdapter, listActiveAccountIds, ensureBootstrapAccount } from '@/lib/adapter/mail/adapterRegistry'

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

  it('多账号各自取到独立 adapter', () => {
    const r1 = seedAccount('m1@163.com')
    const r2 = seedAccount('m2@163.com')
    const a1 = getAdapter(r1.id, { db })
    const a2 = getAdapter(r2.id, { db })
    expect(a1).not.toBeNull()
    expect(a2).not.toBeNull()
    expect(a1).not.toBe(a2) // 独立实例
  })
})

describe('ensureBootstrapAccount (env 引导迁移)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let bdb: any

  beforeEach(() => {
    const raw = Database(':memory:')
    bdb = drizzle(raw, { schema })
    alignBaseline(raw, { migrationsFolder: './drizzle' })
    migrate(bdb, { migrationsFolder: './drizzle' })
  })

  it('库为空且 env 有凭据 → 建默认账号(且幂等)', () => {
    process.env.IMAP_USER = 'env@163.com'
    process.env.IMAP_AUTH_CODE = 'envpw'
    process.env.IMAP_HOST = 'imap.163.com'
    process.env.IMAP_PORT = '993'
    const id = ensureBootstrapAccount(bdb)
    expect(id).toBeGreaterThan(0)
    // 再次调用:已有账号 → null
    expect(ensureBootstrapAccount(bdb)).toBeNull()
    // 推断 provider=163(env host imap.163.com)
    const row = bdb.select().from(accounts).where(eq(accounts.id, id!)).all()[0]
    expect(row?.provider).toBe('163')
    expect(row?.authCode).toBe('envpw')
    delete process.env.IMAP_USER
    delete process.env.IMAP_AUTH_CODE
    delete process.env.IMAP_HOST
    delete process.env.IMAP_PORT
  })

  it('库已有账号 → 返回 null(不重复建)', () => {
    bdb
      .insert(accounts)
      .values({ email: 'x@163.com', provider: '163', user: 'x', authCode: 'p', imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 })
      .run()
    expect(ensureBootstrapAccount(bdb)).toBeNull()
  })

  it('env 无凭据 → 返回 null', () => {
    const old = process.env.IMAP_USER
    delete process.env.IMAP_USER
    expect(ensureBootstrapAccount(bdb)).toBeNull()
    if (old) process.env.IMAP_USER = old
  })
})
