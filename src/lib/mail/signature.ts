// src/lib/mail/signature.ts
// 按 accountId 取签名(settings):账号专用 `signature:{id}` 优先,回落全局 `signature`。plan-05 Task 3。

import type Database from 'better-sqlite3'

export function getSignatureForAccount(db: Database.Database, accountId: number): string {
  const acct = db.prepare('SELECT value FROM settings WHERE key = ?').get(`signature:${accountId}`) as
    | { value: string }
    | undefined
  if (acct?.value) return acct.value
  const global = db.prepare('SELECT value FROM settings WHERE key = ?').get('signature') as
    | { value: string }
    | undefined
  return global?.value ?? ''
}
