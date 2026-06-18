// src/__tests__/folders/sync.test.ts

import { describe, it, expect, vi } from 'vitest'
import { syncFolders } from '@/lib/folders/sync'
import { memDb } from '../helpers/memDb'

describe('syncFolders', () => {
  it('listFolders 结果 upsert 进 folders 表,角标正确', async () => {
    const adapter = {
      listFolders: vi.fn().mockResolvedValue([
        { path: 'INBOX', displayName: 'INBOX', type: 'inbox', unreadCount: 3, totalCount: 10 },
        { path: 'Sent', displayName: 'Sent', type: 'sent', unreadCount: 0, totalCount: 5 },
      ]),
    } as any
    const db = memDb()
    await syncFolders(db, { accountId: 1, adapter })
    const rows = db
      .prepare('SELECT path,type,unread_count,total_count FROM folders WHERE account_id=1 ORDER BY path')
      .all()
    expect(rows).toEqual([
      { path: 'INBOX', type: 'inbox', unread_count: 3, total_count: 10 },
      { path: 'Sent', type: 'sent', unread_count: 0, total_count: 5 },
    ])
  })

  it('二次同步幂等(不报错不重复)', async () => {
    const adapter = {
      listFolders: vi.fn().mockResolvedValue([{ path: 'INBOX', displayName: 'INBOX', type: 'inbox' }]),
    } as any
    const db = memDb()
    await syncFolders(db, { accountId: 1, adapter })
    await syncFolders(db, { accountId: 1, adapter })
    expect(db.prepare('SELECT count(*) c FROM folders WHERE account_id=1').get()).toMatchObject({ c: 1 })
  })

  it('adapter 未给 type 时用 classify 回退', async () => {
    const adapter = {
      listFolders: vi.fn().mockResolvedValue([{ path: '已删除', displayName: '已删除', type: undefined }]),
    } as any
    const db = memDb()
    await syncFolders(db, { accountId: 2, adapter })
    const row = db.prepare('SELECT type FROM folders WHERE account_id=2').get() as any
    expect(row.type).toBe('trash')
  })
})
