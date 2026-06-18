// src/lib/realtime/health.ts
// 账号健康判定 + 降级/恢复决策 + 降级轮询。plan-06 Task 4。

import type Database from 'better-sqlite3'
import type { MailEvent } from '@/lib/events/types'
import type { MailAdapter } from '@/lib/adapter/types'

/** 标记账号降级(sync_status=error)。 */
export function markDegraded(db: Database.Database, opts: { accountId: number; error: string }): void {
  db.prepare('UPDATE accounts SET sync_status = ?, sync_error = ? WHERE id = ?').run(
    'error',
    opts.error,
    opts.accountId,
  )
}

/** 标记账号恢复健康。 */
export function markHealthy(db: Database.Database, accountId: number): void {
  db.prepare("UPDATE accounts SET sync_status = 'healthy', sync_error = NULL WHERE id = ?").run(accountId)
}

export interface PollDecision {
  poll: boolean
  intervalSec?: number
}

/** 是否应走轮询(降级 error→30s;sync_mode=poll→60s;否则 IDLE)。 */
export function shouldPoll(db: Database.Database, accountId: number): PollDecision {
  const row = db.prepare('SELECT sync_status, sync_mode FROM accounts WHERE id = ?').get(accountId) as
    | { sync_status: string; sync_mode: string }
    | undefined
  if (!row) return { poll: false }
  if (row.sync_status === 'error' || row.sync_status === 'disabled') return { poll: true, intervalSec: 30 }
  if (row.sync_mode === 'poll') return { poll: true, intervalSec: 60 }
  return { poll: false }
}

/** 降级轮询:对所有 shouldPoll().poll===true 的活跃账号跑增量拉取。pull 可注入(测试)。 */
export async function runFallbackPoll(
  db: Database.Database,
  opts: {
    getAdapter: (accountId: number) => MailAdapter | null
    publish: (ev: MailEvent) => void
    pull?: (db: Database.Database, o: { accountId: number; folder: string; adapter: MailAdapter; publish: (ev: MailEvent) => void }) => Promise<{ inserted: number }>
    folder?: string
  },
): Promise<void> {
  const folder = opts.folder ?? 'INBOX'
  const accounts = db
    .prepare("SELECT id FROM accounts WHERE is_active = 1")
    .all() as { id: number }[]
  for (const a of accounts) {
    if (!shouldPoll(db, a.id).poll) continue
    const adapter = opts.getAdapter(a.id)
    if (!adapter) continue
    const pull =
      opts.pull ??
      (async (ddb, o) => {
        const { pullIncremental } = await import('./incrementalSync')
        return pullIncremental(ddb, o)
      })
    try {
      await pull(db, { accountId: a.id, folder, adapter, publish: opts.publish })
    } catch (e) {
      console.error('[fallbackPoll]', a.id, e instanceof Error ? e.message : e)
    }
  }
}
