// src/__tests__/realtime/health.test.ts

import { describe, it, expect, vi } from 'vitest'
import { markDegraded, markHealthy, shouldPoll, runFallbackPoll } from '@/lib/realtime/health'
import { memDb } from '../helpers/memDb'

const NOW = Math.floor(Date.now() / 1000)

function seedAcc(
  db: ReturnType<typeof memDb>,
  o: { id?: number; syncStatus: string; syncMode?: string },
) {
  db.prepare(
    `INSERT INTO accounts (id, email, provider, user, auth_code, sync_status, sync_mode, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(o.id ?? 1, 'a@b', '163', 'u', 'p', o.syncStatus, o.syncMode ?? 'idle', NOW)
}

describe('账号健康/降级决策', () => {
  it('markDegraded 写 sync_status=error + sync_error', () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'healthy' })
    markDegraded(db, { accountId: 1, error: 'auth fail' })
    const row = db.prepare('SELECT sync_status, sync_error FROM accounts WHERE id=1').get() as {
      sync_status: string
      sync_error: string
    }
    expect(row.sync_status).toBe('error')
    expect(row.sync_error).toBe('auth fail')
  })

  it('shouldPoll: error → 短间隔轮询(30s)', () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'error' })
    expect(shouldPoll(db, 1)).toEqual({ poll: true, intervalSec: 30 })
  })

  it('shouldPoll: healthy + sync_mode=idle → 不轮询(走 IDLE)', () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'healthy', syncMode: 'idle' })
    expect(shouldPoll(db, 1)).toEqual({ poll: false })
  })

  it('shouldPoll: sync_mode=poll → 轮询(60s)', () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'healthy', syncMode: 'poll' })
    expect(shouldPoll(db, 1)).toEqual({ poll: true, intervalSec: 60 })
  })

  it('markHealthy 恢复 → shouldPoll false', () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'error' })
    markHealthy(db, 1)
    expect(shouldPoll(db, 1)).toEqual({ poll: false })
  })

  it('runFallbackPoll 对 degraded 账号调 pullIncremental', async () => {
    const db = memDb()
    seedAcc(db, { syncStatus: 'error' })
    const pulled = vi.fn().mockResolvedValue({ inserted: 0 })
    await runFallbackPoll(db, { getAdapter: () => ({ fetch: vi.fn().mockResolvedValue([]) }) as any, publish: () => {}, pull: pulled })
    expect(pulled).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountId: 1, folder: 'INBOX' }))
  })
})
