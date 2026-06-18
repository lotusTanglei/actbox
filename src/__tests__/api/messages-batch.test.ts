// src/__tests__/api/messages-batch.test.ts
// TDD: POST /api/messages/batch 批量操作。plan-08 Task 8。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
  adapter: {
    move: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))
vi.mock('@/lib/adapter/mail/adapterRegistry', () => ({ getAdapter: () => refs.adapter }))

import { POST } from '@/app/api/messages/batch/route'

const NOW = Math.floor(Date.now() / 1000)

function req(body: object) {
  return new NextRequest('http://localhost/api/messages/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function call(body: object) {
  return POST(req(body))
}

describe('POST /api/messages/batch', () => {
  beforeEach(() => {
    refs.raw = memDb()
    vi.clearAllMocks()

    refs.raw!.exec(`DELETE FROM message_labels; DELETE FROM labels; DELETE FROM messages;`)

    // 文件夹表（archive 路径）
    refs.raw!.exec(`INSERT INTO folders (account_id, path, display_name, type) VALUES (1, 'Archive', '归档', 'archive')`)

    // 3 封邮件，account_id=1, folder=INBOX, imap_uid 非空
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, imap_uid, is_read, is_starred, is_deleted, is_archived, received_at, processed_at, todo_count)
      VALUES (1, '<m1>', 1, '测试1', 'a@x.com', 'in', 'INBOX', 101, 0, 0, 0, 0, ${NOW}, ${NOW}, 0)`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, imap_uid, is_read, is_starred, is_deleted, is_archived, received_at, processed_at, todo_count)
      VALUES (2, '<m2>', 1, '测试2', 'b@x.com', 'in', 'INBOX', 102, 0, 0, 0, 0, ${NOW}, ${NOW}, 0)`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, imap_uid, is_read, is_starred, is_deleted, is_archived, received_at, processed_at, todo_count)
      VALUES (3, '<m3>', 1, '测试3', 'c@x.com', 'in', 'INBOX', 103, 0, 0, 0, 0, ${NOW}, ${NOW}, 0)`)
  })

  it('批量 archive 调 applyAction archive', async () => {
    const res = await call({ messageIds: [1, 2], action: 'archive' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.updated).toBe(2)
    const r1 = refs.raw!.prepare('SELECT is_archived, folder FROM messages WHERE id=1').get() as any
    expect(r1.is_archived).toBe(1)
  })

  it('批量 markRead value=true', async () => {
    const res = await call({ messageIds: [1, 2], action: 'markRead', value: true })
    expect(res.status).toBe(200)
    const r1 = refs.raw!.prepare('SELECT is_read FROM messages WHERE id=1').get() as any
    expect(r1.is_read).toBe(1)
  })

  it('批量 label 带 labelIds', async () => {
    refs.raw!.exec(`INSERT INTO labels (id, account_id, name, color) VALUES (1, 1, '重要', '#ef4444')`)
    const res = await call({ messageIds: [1, 2], action: 'label', labelIds: [1] })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.updated).toBe(2)
    const c = refs.raw!.prepare('SELECT count(*) c FROM message_labels').get() as { c: number }
    expect(c.c).toBe(2)
  })

  it('批量 move 带 targetFolder', async () => {
    const res = await call({ messageIds: [1], action: 'move', targetFolder: 'Archive' })
    expect(res.status).toBe(200)
    const r = refs.raw!.prepare('SELECT folder FROM messages WHERE id=1').get() as any
    expect(r.folder).toBe('Archive')
  })

  it('批量 delete', async () => {
    const res = await call({ messageIds: [3], action: 'delete' })
    expect(res.status).toBe(200)
    const r = refs.raw!.prepare('SELECT is_deleted FROM messages WHERE id=3').get() as any
    expect(r.is_deleted).toBe(1)
  })

  it('非法 action → 400', async () => {
    const res = await call({ messageIds: [1], action: 'invalid' })
    expect(res.status).toBe(400)
  })

  it('空 messageIds → 400', async () => {
    const res = await call({ messageIds: [], action: 'archive' })
    expect(res.status).toBe(400)
  })
})
