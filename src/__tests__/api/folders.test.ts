// src/__tests__/api/folders.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  db: null as ReturnType<typeof memDb> | null,
  adapter: { listFolders: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ getRawDb: () => refs.db, getDb: () => refs.db }))
vi.mock('@/lib/adapter/mail/adapterRegistry', () => ({
  getAdapter: () => refs.adapter,
  listActiveAccountIds: () => [1],
}))

import { GET, POST } from '@/app/api/folders/route'

function req(search?: string, body?: object) {
  const url = search ? `http://localhost/api/folders?${search}` : 'http://localhost/api/folders'
  return new NextRequest(
    url,
    body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : { method: 'GET' },
  )
}

describe('/api/folders', () => {
  beforeEach(() => {
    refs.db = memDb()
  })

  it('GET ?accountId=1 返回 folders 行', async () => {
    refs.db!.exec(
      `INSERT INTO folders (account_id, path, display_name, type, unread_count, total_count) VALUES (1,'INBOX','INBOX','inbox',3,10)`,
    )
    const res = await GET(req('accountId=1'))
    const data = await res.json()
    expect(data.folders).toHaveLength(1)
    expect(data.folders[0].path).toBe('INBOX')
    expect(data.folders[0].unread_count).toBe(3)
  })

  it('POST {accountId} 触发同步返回数量并入库', async () => {
    refs.adapter.listFolders = vi.fn().mockResolvedValue([
      { path: 'INBOX', displayName: 'INBOX', type: 'inbox', unreadCount: 1, totalCount: 2 },
    ])
    const res = await POST(req(undefined, { accountId: 1 }))
    const data = await res.json()
    expect(data.synced).toBe(1)
    expect(refs.db!.prepare('SELECT count(*) c FROM folders WHERE account_id = 1').get()).toMatchObject({ c: 1 })
  })
})
