// src/__tests__/realtime/incrementalSync.test.ts

import { describe, it, expect, vi } from 'vitest'
import { pullIncremental } from '@/lib/realtime/incrementalSync'
import { memDb } from '../helpers/memDb'

const NOW = Math.floor(Date.now() / 1000)

describe('pullIncremental EXISTS 触发增量', () => {
  it('拉取 folder 内 since-last-uid 的新邮件,入库并 publish new-mail/unread-count', async () => {
    const adapter = {
      fetch: vi.fn().mockResolvedValue([
        { messageId: '<m1>', subject: 's1', from: 'a@x', body: '', bodyHtml: null, receivedAt: new Date(), imapUid: 30 },
      ]),
    } as any
    const db = memDb()
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('uidhigh:1:INBOX', '29')
    const publish = vi.fn()
    const r = await pullIncremental(db, { accountId: 1, folder: 'INBOX', adapter, publish })
    expect(adapter.fetch).toHaveBeenCalledWith(expect.objectContaining({ folder: 'INBOX', uidRange: [30, null] }))
    expect(r.inserted).toBe(1)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'new-mail',
        payload: expect.objectContaining({ messageId: '<m1>', accountId: 1, folder: 'INBOX' }),
      }),
    )
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('uidhigh:1:INBOX') as { value: string }
    expect(row.value).toBe('30')
  })

  it('UIDVALIDITY 变化不重复入库(按 message_id 去重)', async () => {
    const adapter = {
      fetch: vi
        .fn()
        .mockResolvedValue([
          { messageId: '<m1>', subject: 's', from: 'a', body: '', bodyHtml: null, receivedAt: new Date(), imapUid: 5 },
        ]),
    } as any
    const db = memDb()
    db.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, direction, processed_at) VALUES ('<m1>',1,'INBOX',10,'in',${NOW})`,
    )
    const r = await pullIncremental(db, { accountId: 1, folder: 'INBOX', adapter, publish: () => {}, uidValidity: 999 })
    const row = db.prepare('SELECT count(*) c FROM messages WHERE account_id=1 AND folder=?').get('INBOX') as { c: number }
    expect(row.c).toBe(1) // 不重复
    expect(r.inserted).toBeGreaterThanOrEqual(1)
  })

  it('无新邮件不 publish', async () => {
    const adapter = { fetch: vi.fn().mockResolvedValue([]) } as any
    const publish = vi.fn()
    const r = await pullIncremental(memDb(), { accountId: 1, folder: 'INBOX', adapter, publish })
    expect(r.inserted).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })
})
