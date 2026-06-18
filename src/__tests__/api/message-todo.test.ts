// src/__tests__/api/message-todo.test.ts
// TDD: 邮件一键转待办 API。plan-08 Task 10。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
}))

vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { POST } from '@/app/api/messages/[id]/todo/route'

const NOW = Math.floor(Date.now() / 1000)

function req(id: number, body?: object) {
  return new NextRequest(`http://localhost/api/messages/${id}/todo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/messages/[id]/todo', () => {
  beforeEach(() => {
    refs.raw = memDb()
    refs.raw!.exec(`DELETE FROM todos; DELETE FROM messages;`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, is_read, is_deleted, received_at, processed_at, todo_count)
      VALUES (1, '<m@x>', 1, '确认需求', 'boss@x.com', 'in', 'INBOX', 0, 0, ${NOW}, ${NOW}, 0)`)
  })

  it('从邮件创建待办: title 取 subject, sourceMessageId 取 message.messageId', async () => {
    const res = await POST(req(1, { title: '确认需求', priority: 'high' }), ctx('1'))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.todo.title).toBe('确认需求')
    expect(data.todo.sourceMessageId).toBe('<m@x>')
    expect(data.todo.sourceSubject).toBe('确认需求')
    expect(data.todo.sourceFrom).toBe('boss@x.com')

    // todo_count 回写
    const msg = refs.raw!.prepare('SELECT todo_count FROM messages WHERE id=1').get() as any
    expect(msg.todo_count).toBe(1)
  })

  it('无 title 回退用 subject', async () => {
    const res = await POST(req(1, {}), ctx('1'))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.todo.title).toBe('确认需求')
  })

  it('邮件不存在 → 404', async () => {
    const res = await POST(req(999), ctx('999'))
    expect(res.status).toBe(404)
  })
})
