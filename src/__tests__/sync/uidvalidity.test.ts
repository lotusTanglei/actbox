// src/__tests__/sync/uidvalidity.test.ts

import { describe, it, expect } from 'vitest'
import { checkUidValidity } from '@/lib/sync/uidvalidity'
import { memDb } from '../helpers/memDb'

describe('UIDVALIDITY 处理', () => {
  it('首次记录返回 known=false(无旧值),不清', () => {
    const db = memDb()
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    expect(r.known).toBe(false)
    expect(r.mustRemap).toBe(false)
  })

  it('相同 uidValidity 不重映射', () => {
    const db = memDb()
    checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    expect(r.mustRemap).toBe(false)
  })

  it('uidValidity 变化 → mustRemap=true,返回受影响旧 uid 列表', () => {
    const db = memDb()
    const now = Math.floor(Date.now() / 1000)
    db.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, direction, processed_at)
       VALUES ('<m1>',1,'INBOX',10,'in',${now}),('<m2>',1,'INBOX',11,'in',${now})`,
    )
    checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 999 })
    expect(r.mustRemap).toBe(true)
    expect((r.staleUids ?? []).sort()).toEqual([10, 11])
    // 重映射:清空旧 imap_uid,防重复入库
    const cleared = db
      .prepare('SELECT count(*) c FROM messages WHERE account_id = ? AND folder = ? AND imap_uid IS NOT NULL')
      .get(1, 'INBOX') as any
    expect(cleared.c).toBe(0)
  })
})
