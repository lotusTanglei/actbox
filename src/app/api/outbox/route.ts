// src/app/api/outbox/route.ts — GET 列表 / POST 入队(undo/schedule/now)
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { parseLocalToUtc, toLocalDisplay, systemTimezone } from '@/lib/outbox/time'

const ALLOWED_UNDO = [5, 10, 20, 30]

export function getUndoWindowSeconds(db: any): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='outbox.undoWindowSeconds'").get() as any
    if (row) { const n = Number(row.value); if (ALLOWED_UNDO.includes(n)) return n }
  } catch { /* noop */ }
  return 10
}

export async function GET(req: NextRequest) {
  const db = getRawDb()
  const status = new URL(req.url).searchParams.get('status')
  const rows = status
    ? (db.prepare('SELECT * FROM outbox WHERE status=? ORDER BY scheduled_at DESC').all(status) as any[])
    : (db.prepare("SELECT * FROM outbox WHERE status!='sent' ORDER BY scheduled_at DESC").all() as any[])
  const items = rows.map((r) => ({ ...r, scheduledAtLocal: toLocalDisplay(r.scheduled_at).label }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { to, cc, bcc, subject, bodyHtml } = body
  if (!to || !subject || !bodyHtml) {
    return NextResponse.json({ error: 'Missing to, subject, or bodyHtml' }, { status: 400 })
  }
  const db = getRawDb()
  const now = Date.now()
  let scheduledAt: number
  const mode = body.sendMode || 'undo'
  if (mode === 'schedule') {
    scheduledAt = parseLocalToUtc(body.scheduledAt, body.timezone || systemTimezone())
    if (scheduledAt <= now) return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 })
  } else if (mode === 'now') {
    scheduledAt = now
  } else {
    scheduledAt = now + getUndoWindowSeconds(db) * 1000
  }
  const res = db.prepare(
    "INSERT INTO outbox (account_id, \"to\", cc, bcc, subject, body_html, scheduled_at, status, attempts) VALUES (?,?,?,?,?,?,?,'queued',0)"
  ).run(body.accountId ?? null, to, cc || null, bcc || null, subject, bodyHtml, scheduledAt)
  return NextResponse.json({
    id: Number(res.lastInsertRowid),
    scheduledAt,
    scheduledAtLocal: toLocalDisplay(scheduledAt).label,
    undoWindowSeconds: mode === 'undo' ? getUndoWindowSeconds(db) : 0,
  }, { status: 201 })
}
