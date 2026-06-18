// src/__tests__/api/messages-filter.test.ts
// TDD: GET /api/messages 按标签过滤 / 隐藏 snoozed / 会话分组。plan-08 Task 7。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({
  raw: null as ReturnType<typeof memDb> | null,
  ddb: null as ReturnType<typeof drizzle> | null,
}))

vi.mock('@/lib/db', () => ({ getDb: () => refs.ddb, getRawDb: () => refs.raw }))

import { GET } from '@/app/api/messages/route'

const NOW = Math.floor(Date.now() / 1000)
const FUTURE = NOW + 86400

function req(url: string) {
  return new NextRequest(`http://localhost${url}`)
}

describe('GET /api/messages 过滤', () => {
  beforeEach(() => {
    refs.raw = memDb()
    refs.ddb = drizzle(refs.raw!, { schema })

    // seed: 3 封邮件 + 1 标签 + 1 关联
    refs.raw!.exec(`DELETE FROM message_labels; DELETE FROM labels; DELETE FROM messages;`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, is_read, is_deleted, snoozed_until, thread_id, received_at, processed_at, todo_count)
      VALUES (1, '<m1>', 1, '测试标签', 'a@x.com', 'in', 0, 0, NULL, 't1', ${NOW}, ${NOW}, 0)`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, is_read, is_deleted, snoozed_until, thread_id, received_at, processed_at, todo_count)
      VALUES (2, '<m2>', 1, '无标签', 'b@x.com', 'in', 0, 0, ${FUTURE}, 't2', ${NOW}, ${NOW}, 0)`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, is_read, is_deleted, snoozed_until, thread_id, received_at, processed_at, todo_count)
      VALUES (3, '<m3>', 1, '同会话第二封', 'c@x.com', 'in', 0, 0, NULL, 't1', ${NOW}, ${NOW}, 0)`)
    refs.raw!.exec(`INSERT INTO labels (id, account_id, name, color) VALUES (1, 1, '重要', '#ef4444')`)
    refs.raw!.exec(`INSERT INTO message_labels (message_id, label_id) VALUES (1, 1)`)
  })

  it('默认排除 snoozed 未到期邮件 (snoozed_until > now)', async () => {
    const res = await GET(req('/api/messages'))
    const data = await res.json()
    const ids = data.messages.map((m: any) => m.id)
    expect(ids).not.toContain(2) // snoozed 未来
    expect(ids).toContain(1)
    expect(ids).toContain(3)
  })

  it('?labelId=1 只返回贴该标签的邮件', async () => {
    const res = await GET(req('/api/messages?labelId=1'))
    const data = await res.json()
    const ids = data.messages.map((m: any) => m.id)
    expect(ids).toEqual([1])
  })

  it('?thread=group 按 thread_id 聚合返回会话头（每会话最新一封 + count）', async () => {
    const res = await GET(req('/api/messages?thread=group'))
    const data = await res.json()
    // t1 有 2 封邮件; t2 被 snoozed 排除
    expect(data.messages).toHaveLength(1)
    const thread = data.messages[0]
    expect(thread.threadId).toBe('t1')
    expect(thread.count).toBe(2)
  })

  it('?threadId=t1 展开该会话全部邮件', async () => {
    const res = await GET(req('/api/messages?threadId=t1'))
    const data = await res.json()
    expect(data.messages).toHaveLength(2)
    expect(data.messages.map((m: any) => m.id).sort()).toEqual([1, 3])
  })
})
