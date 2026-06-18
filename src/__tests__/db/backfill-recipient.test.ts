// src/__tests__/db/backfill-recipient.test.ts

import { describe, it, expect } from 'vitest'
import { backfillRecipientToTo } from '@/lib/db/backfill-runner'
import { memDb } from '../helpers/memDb'

describe('recipient → to 回填', () => {
  it('to 为空且 recipient 有值的行回填到 to,幂等', () => {
    const db = memDb()
    const now = Math.floor(Date.now() / 1000)
    db.exec(
      `INSERT INTO messages (message_id, recipient, direction, processed_at) VALUES ('<m1>','a@x,b@y','out',${now}),('<m2>',NULL,'out',${now})`,
    )
    const stats = backfillRecipientToTo(db)
    expect(stats.refilled).toBe(1)
    const row = db.prepare('SELECT "to" AS t FROM messages WHERE message_id=\'<m1>\'').get() as { t: string }
    expect(row.t).toBe('a@x,b@y')
    // 幂等:to 已有值不再动
    expect(backfillRecipientToTo(db).refilled).toBe(0)
  })

  it('to 已有值不覆盖', () => {
    const db = memDb()
    const now = Math.floor(Date.now() / 1000)
    db.exec(
      `INSERT INTO messages (message_id, recipient, "to", direction, processed_at) VALUES ('<m1>','legacy@x','keep@x','out',${now})`,
    )
    expect(backfillRecipientToTo(db).refilled).toBe(0)
    const row = db.prepare('SELECT "to" AS t FROM messages WHERE message_id=\'<m1>\'').get() as { t: string }
    expect(row.t).toBe('keep@x')
  })
})
