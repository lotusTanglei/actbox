// src/__tests__/mail/signature.test.ts

import { describe, it, expect } from 'vitest'
import type Database from 'better-sqlite3'
import { getSignatureForAccount } from '@/lib/mail/signature'
import { memDb } from '../helpers/memDb'

function putSetting(db: Database.Database, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

describe('签名加载', () => {
  it('按 accountId 取专用签名,缺省回落全局', () => {
    const db = memDb()
    putSetting(db, 'signature', 'Global sig')
    putSetting(db, 'signature:1', 'Account1 sig')
    expect(getSignatureForAccount(db, 1)).toBe('Account1 sig')
    expect(getSignatureForAccount(db, 2)).toBe('Global sig')
  })

  it('无任何签名返回空串', () => {
    expect(getSignatureForAccount(memDb(), 1)).toBe('')
  })
})
