// src/app/api/calendar/events/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const row = getRawDb().prepare('SELECT * FROM events WHERE id=?').get(Number(id))
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ event: row })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()
  const db = getRawDb()
  const sets: string[] = []; const vals: any[] = []
  for (const [col, key] of [['title','title'],['starts_at','startsAt'],['ends_at','endsAt'],['all_day','allDay'],['location','location'],['description','description'],['reminder_minutes','reminderMinutes']] as const) {
    if (body[key] !== undefined) { sets.push(`${col}=?`); vals.push(body.allDay !== undefined && key === 'allDay' ? (body.allDay ? 1 : 0) : body[key]) }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })
  vals.push(Number(id))
  db.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).run(...vals)
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(Number(id))
  return NextResponse.json({ event: row })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  getRawDb().prepare('DELETE FROM events WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
