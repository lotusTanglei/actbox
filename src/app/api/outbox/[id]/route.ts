// src/app/api/outbox/[id]/route.ts — GET 单条 + DELETE 撤销
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { toLocalDisplay } from '@/lib/outbox/time'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const row = getRawDb().prepare('SELECT * FROM outbox WHERE id=?').get(Number(id)) as any
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ item: { ...row, scheduledAtLocal: toLocalDisplay(row.scheduled_at).label } })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = getRawDb()
  const row = db.prepare('SELECT status FROM outbox WHERE id=?').get(Number(id)) as any
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status !== 'queued') {
    return NextResponse.json({ error: `无法撤销:状态为 ${row.status}(仅未发送的 queued 可撤销)` }, { status: 409 })
  }
  db.prepare('DELETE FROM outbox WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
