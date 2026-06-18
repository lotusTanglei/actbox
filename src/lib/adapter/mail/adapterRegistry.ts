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

/**
 * env 引导迁移:库中无任何账号、但 env 有 IMAP_USER/IMAP_AUTH_CODE 时,
 * 自动建一个默认账号(从旧的单账号 .env.local 平滑迁移到多账号模型)。
 * 幂等:已有账号或 env 无凭据 → 返回 null。
 */
export function ensureBootstrapAccount(db?: Db): number | null {
  const _db = db ?? getDb()
  const existing = _db.select({ id: accounts.id }).from(accounts).all()
  if (existing.length > 0) return null

  const user = process.env.IMAP_USER
  const authCode = process.env.IMAP_AUTH_CODE
  if (!user || !authCode) return null

  const imapHost = process.env.IMAP_HOST || ''
  const [row] = _db
    .insert(accounts)
    .values({
      email: user,
      provider: inferProvider(imapHost),
      protocol: 'imap',
      user,
      authCode,
      imapHost: imapHost || null,
      imapPort: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT, 10) : null,
      smtpHost: process.env.SMTP_HOST || null,
      smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : null,
      displayName: '默认账号',
    })
    .returning()
    .all() as any[]
  return row?.id ?? null
}

/** 根据 IMAP host 推断 provider(用于 env 引导) */
function inferProvider(host: string): '163' | '126' | 'qq' | 'gmail' | 'outlook' | 'custom' {
  const h = (host || '').toLowerCase()
  if (h.includes('163')) return '163'
  if (h.includes('126')) return '126'
  if (h.includes('qq')) return 'qq'
  if (h.includes('gmail')) return 'gmail'
  if (h.includes('office365') || h.includes('outlook')) return 'outlook'
  return 'custom'
}
