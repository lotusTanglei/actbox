// src/__tests__/api/message-actions.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  db: null as ReturnType<typeof memDb> | null,
  adapter: {
    markRead: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/db', () => ({ getRawDb: () => refs.db, getDb: () => refs.db }))
vi.mock('@/lib/adapter/mail/adapterRegistry', () => ({ getAdapter: () => refs.adapter }))

import { PATCH } from '@/app/api/messages/[id]/route'

const NOW = Math.floor(Date.now() / 1000)

function req(id: number, body: object) {
  return new NextRequest(`http://localhost/api/messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('/api/messages/[id] PATCH action', () => {
  beforeEach(() => {
    refs.db = memDb()
    refs.db!.exec(
      `INSERT INTO messages (message_id, account_id, folder, imap_uid, is_read, direction, processed_at)
       VALUES ('<m1>', 1, 'INBOX', 10, 0, 'in', ${NOW})`,
    )
  })

  it('archive → 200 + is_archived=1', async () => {
    const res = await PATCH(req(1, { action: 'archive' }), ctx('1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message.is_archived).toBe(1)
  })

  it('move → 200 + folder 更新', async () => {
    const res = await PATCH(req(1, { action: 'move', targetFolder: 'X' }), ctx('1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message.folder).toBe('X')
  })

  it('restore → 200', async () => {
    refs.db!.exec(`UPDATE messages SET folder = 'Trash', is_deleted = 1 WHERE id = 1`)
    const res = await PATCH(req(1, { action: 'restore' }), ctx('1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message.folder).toBe('INBOX')
  })

  it('delete → 200 + is_deleted=1', async () => {
    const res = await PATCH(req(1, { action: 'delete' }), ctx('1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message.is_deleted).toBe(1)
  })

  it('非法 action → 400', async () => {
    const res = await PATCH(req(1, { action: 'bogus' }), ctx('1'))
    expect(res.status).toBe(400)
  })
})
