// src/app/api/calendar/events/route.ts — GET(区间) + POST(新建)
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const from = sp.get('from') ? Number(sp.get('from')) : Date.now() - 30 * 86400000
  const to = sp.get('to') ? Number(sp.get('to')) : Date.now() + 60 * 86400000
  const rows = getRawDb().prepare(
    'SELECT * FROM events WHERE starts_at < ? AND COALESCE(ends_at, starts_at+3600000) > ? ORDER BY starts_at ASC'
  ).all(to, from)
  return NextResponse.json({ events: rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.title || !body.startsAt) return NextResponse.json({ error: 'Missing title or startsAt' }, { status: 400 })
  const db = getRawDb()
  const r = db.prepare(
    'INSERT INTO events (account_id, title, starts_at, ends_at, all_day, location, description, reminder_minutes, source_message_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    body.accountId ?? null, body.title, body.startsAt, body.endsAt ?? null,
    body.allDay ? 1 : 0, body.location || null, body.description || null,
    body.reminderMinutes ?? null, body.sourceMessageId || null, Date.now(),
  )
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(Number(r.lastInsertRowid))
  return NextResponse.json({ event: row }, { status: 201 })
}
