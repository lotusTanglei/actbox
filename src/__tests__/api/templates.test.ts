// src/__tests__/api/templates.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

let mockDb: any
vi.mock('@/lib/db', () => ({
  getRawDb: () => mockDb,
  getDb: () => mockDb,
}))

function freshDb() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, body_html TEXT NOT NULL, variables TEXT, created_at INTEGER)')
  mockDb = db
}

import { GET, POST, DELETE } from '@/app/api/templates/route'

function req(url: string, init?: any) {
  return new Request(url, init) as any
}

describe('/api/templates', () => {
  beforeEach(() => freshDb())

  it('POST 建模板 + 自动抽 variables', async () => {
    const res = await POST(req('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '问候', bodyHtml: '你好 {{name}}' }) }))
    expect(res.status).toBe(201)
    const row = mockDb.prepare('SELECT name, variables FROM templates WHERE id=1').get() as any
    expect(row.name).toBe('问候')
    expect(JSON.parse(row.variables)).toEqual(['name'])
  })
  it('POST 缺 name → 400', async () => {
    const res = await POST(req('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bodyHtml: 'x' }) }))
    expect(res.status).toBe(400)
  })
  it('GET 列出', async () => {
    await POST(req('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'T', bodyHtml: 'hi {{x}}' }) }))
    const j = await (await GET(req('http://x/api/templates'))).json()
    expect(j.templates).toHaveLength(1)
    expect(j.templates[0].name).toBe('T')
  })
  it('DELETE by id', async () => {
    await POST(req('http://x/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'T', bodyHtml: 'x' }) }))
    await DELETE(req('http://x/api/templates?id=1', { method: 'DELETE' }))
    expect((mockDb.prepare('SELECT count(*) c FROM templates').get() as any).c).toBe(0)
  })
})
