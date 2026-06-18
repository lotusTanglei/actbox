// src/__tests__/sync/writeback.test.ts

import { describe, it, expect, vi } from 'vitest'
import { applyAction } from '@/lib/sync/writeback'
import { memDb } from '../helpers/memDb'

const NOW = Math.floor(Date.now() / 1000)

function seed(db: ReturnType<typeof memDb>, extra = '') {
  db.exec(
    `INSERT INTO messages (message_id, account_id, folder, imap_uid, is_read, direction, processed_at)
     VALUES ('<m1>', 1, 'INBOX', 10, 0, 'in', ${NOW})${extra}`,
  )
}

describe('applyAction 回写', () => {
  it('markRead 乐观更新 + 调 adapter.markRead + 幂等', async () => {
    const adapter = { markRead: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    seed(db)
    await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true })
    expect(adapter.markRead).toHaveBeenCalledWith(10, 'INBOX', true)
    expect((db.prepare('SELECT is_read FROM messages WHERE id=1').get() as any).is_read).toBe(1)
    adapter.markRead.mockClear()
    await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true }) // 幂等
    expect(adapter.markRead).not.toHaveBeenCalled()
  })

  it('move 乐观更新 folder + 调 adapter.move', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    seed(db)
    await applyAction(db, { adapter, action: 'move', messageIds: [1], targetFolder: 'Archive' })
    expect(adapter.move).toHaveBeenCalledWith(10, 'INBOX', 'Archive')
    expect((db.prepare('SELECT folder FROM messages WHERE id=1').get() as any).folder).toBe('Archive')
  })

  it('archive 设 is_archived + archived_at + move', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    seed(db)
    await applyAction(db, { adapter, action: 'archive', messageIds: [1] })
    const row = db.prepare('SELECT is_archived, archived_at, folder FROM messages WHERE id=1').get() as any
    expect(row.is_archived).toBe(1)
    expect(row.archived_at).not.toBeNull()
    expect(adapter.move).toHaveBeenCalledWith(10, 'INBOX', 'Archive')
  })

  it('restore 取消 is_deleted + move 回 INBOX', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    db.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, is_deleted, is_archived, direction, processed_at)
       VALUES ('<m1>', 1, 'Trash', 10, 1, 0, 'in', ${NOW})`,
    )
    await applyAction(db, { adapter, action: 'restore', messageIds: [1] })
    expect(adapter.move).toHaveBeenCalledWith(10, 'Trash', 'INBOX')
    const row = db.prepare('SELECT is_deleted, folder FROM messages WHERE id=1').get() as any
    expect(row.is_deleted).toBe(0)
    expect(row.folder).toBe('INBOX')
  })

  it('adapter 失败 → 回滚乐观更新', async () => {
    const adapter = { markRead: vi.fn().mockRejectedValue(new Error('net')) } as any
    const db = memDb()
    seed(db)
    await expect(applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true })).rejects.toThrow('net')
    expect((db.prepare('SELECT is_read FROM messages WHERE id=1').get() as any).is_read).toBe(0)
  })

  it('markRead 成功后 publish message-updated(isRead)', async () => {
    const adapter = { markRead: vi.fn().mockResolvedValue(undefined) } as any
    const publish = vi.fn()
    const db = memDb()
    seed(db)
    await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true, publish })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message-updated',
        payload: expect.objectContaining({
          messageId: '<m1>',
          accountId: 1,
          folder: 'INBOX',
          changes: { isRead: true },
        }),
      }),
    )
  })

  it('move 成功后 publish message-updated(folder) + unread-count', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const publish = vi.fn()
    const db = memDb()
    seed(db)
    await applyAction(db, { adapter, action: 'move', messageIds: [1], targetFolder: 'Archive', publish })
    const types = publish.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toContain('message-updated')
    expect(types).toContain('unread-count')
  })

  it('无 publish 时向后兼容(不抛错)', async () => {
    const adapter = { markRead: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    seed(db)
    await expect(applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true })).resolves.toBeUndefined()
  })
})
