// src/__tests__/api/contacts-autocomplete.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memDb } from '../helpers/memDb'

const refs = vi.hoisted(() => ({ raw: null as ReturnType<typeof memDb> | null }))
vi.mock('@/lib/db', () => ({ getDb: () => refs.raw, getRawDb: () => refs.raw }))

import { GET } from '@/app/api/contacts/autocomplete/route'

function req(q: string) {
  return new NextRequest(`http://x/api/contacts/autocomplete?q=${encodeURIComponent(q)}`)
}

describe('GET /api/contacts/autocomplete', () => {
  beforeEach(() => {
    refs.raw = memDb()
  })

  it('?q= 返回命中（通讯录置顶）', async () => {
    refs.raw!.exec(`INSERT INTO contacts (account_id, name, email, contact_count) VALUES (1,'A','a@x.com',2)`)
    refs.raw!.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, direction, folder, received_at, processed_at, todo_count)
      VALUES (1,'<m>',1,'s','b@x.com','in','INBOX',${Math.floor(Date.now()/1000)},${Math.floor(Date.now()/1000)},0)`)
    const res = await GET(req('x.com'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hits.some((h: any) => h.email === 'a@x.com')).toBe(true)
  })
})
