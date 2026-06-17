// src/lib/adapter/mail/adapterRegistry.ts
// 按 accountId 从库取配置 → 构造 ImapAdapter。db 可注入便于测试。

import { getDb } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ImapAdapter } from './imapAdapter'
import type { AccountConfig, MailAdapter } from '../types'

type Db = ReturnType<typeof getDb>

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToConfig(row: any): AccountConfig {
  return {
    id: row.id,
    email: row.email,
    user: row.user,
    authCode: row.authCode,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    displayName: row.displayName ?? undefined,
  }
}

export function getAccountConfig(id: number, db?: Db): AccountConfig | null {
  const _db = db ?? getDb()
  const row = _db.select().from(accounts).where(eq(accounts.id, id)).all()[0] as any
  return row ? rowToConfig(row) : null
}

export function getAdapter(id: number, opts?: { db?: Db; inject?: any }): MailAdapter | null {
  const cfg = getAccountConfig(id, opts?.db)
  if (!cfg) return null
  return new ImapAdapter(cfg, opts?.inject)
}

export function listActiveAccountIds(db?: Db): number[] {
  const _db = db ?? getDb()
  const rows = _db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .all() as { id: number }[]
  return rows.map((r) => r.id)
}
