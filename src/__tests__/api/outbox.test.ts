// src/__tests__/api/outbox.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

let mockDb: any
vi.mock('@/lib/db', () => ({
  getRawDb: () => mockDb,
  getDb: () => mockDb,
}))

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, "to" TEXT NOT NULL, cc TEXT, bcc TEXT, subject TEXT, body_html TEXT, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER, sent_at INTEGER);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  mockDb = db
}

import { GET, POST } from '@/app/api/outbox/route'

function req(url: string, body: object) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any
}

describe('POST /api/outbox', () => {
  beforeEach(() => freshDb())

  it('undo 模式:scheduledAt = now + undoWindow(默认10s)', async () => {
    const before = Date.now()
    const res = await POST(req('http://x/api/outbox', { to: 'a@b', subject: 'S', bodyHtml: '<p>x</p>', sendMode: 'undo' }))
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.scheduledAt).toBeGreaterThanOrEqual(before + 9000)
    expect(j.scheduledAt).toBeLessThanOrEqual(before + 11000)
    expect((mockDb.prepare('SELECT status FROM outbox WHERE id=?').get(j.id) as any).status).toBe('queued')
  })
  it('undoWindow 可配(settings 20s)', async () => {
    mockDb.prepare("INSERT INTO settings (key,value) VALUES ('outbox.undoWindowSeconds','20')").run()
    const before = Date.now()
    const j = await (await POST(req('http://x/api/outbox', { to: 'a@b', subject: 'S', bodyHtml: 'x' }))).json()
    expect(j.scheduledAt).toBeGreaterThanOrEqual(before + 19000)
  })
  it('schedule 过去时间 → 400', async () => {
    const res = await POST(req('http://x/api/outbox', { to: 'a@b', subject: 'S', bodyHtml: 'x', sendMode: 'schedule', scheduledAt: { date: '2020-01-01', time: '00:00' } }))
    expect(res.status).toBe(400)
  })
  it('缺 to → 400', async () => {
    const res = await POST(req('http://x/api/outbox', { subject: 'S', bodyHtml: 'x' }))
    expect(res.status).toBe(400)
  })
})
