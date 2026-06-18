// src/__tests__/sync/retention.test.ts

import { describe, it, expect, vi } from 'vitest'
import { purgeExpiredDeleted } from '@/lib/sync/retention'
import { memDb } from '../helpers/memDb'

describe('保留期清除', () => {
  it('is_deleted 超 N 天的邮件彻底删除(物理 + adapter.delete)', async () => {
    const adapter = { delete: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    const old = Math.floor(Date.now() / 1000) - 31 * 86400
    const now = Math.floor(Date.now() / 1000)
    db.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, is_deleted, archived_at, direction, processed_at)
       VALUES ('<m1>',1,'Trash',10,1,${old},'in',${now}),('<m2>',1,'Trash',11,1,${now},'in',${now})`,
    )
    const stats = await purgeExpiredDeleted(db, { adapter, retentionDays: 30 })
    expect(stats.purged).toBe(1)
    expect(adapter.delete).toHaveBeenCalledTimes(1)
    expect(adapter.delete).toHaveBeenCalledWith(10, 'Trash')
    const left = db.prepare('SELECT count(*) c FROM messages WHERE id = 1').get() as any
    expect(left.c).toBe(0)
  })

  it('adapter.delete 失败 → 不删本地,下次重试', async () => {
    const adapter = { delete: vi.fn().mockRejectedValue(new Error('net')) } as any
    const db = memDb()
    const old = Math.floor(Date.now() / 1000) - 60 * 86400
    const now = Math.floor(Date.now() / 1000)
    db.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, is_deleted, archived_at, direction, processed_at)
       VALUES ('<m1>',1,'Trash',10,1,${old},'in',${now})`,
    )
    const stats = await purgeExpiredDeleted(db, { adapter, retentionDays: 30 })
    expect(stats.purged).toBe(0)
    const left = db.prepare('SELECT count(*) c FROM messages').get() as any
    expect(left.c).toBe(1) // 仍在,等下次重试
  })
})
