// src/app/api/outbox/[id]/retry/route.ts — POST 手动重试 failed/bounced
import { NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = getRawDb()
  const row = db.prepare('SELECT status FROM outbox WHERE id=?').get(Number(id)) as any
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status !== 'failed' && row.status !== 'bounced') {
    return NextResponse.json({ error: `无法重试:状态为 ${row.status}(仅 failed/bounced 可重试)` }, { status: 409 })
  }
  db.prepare("UPDATE outbox SET status='queued', attempts=0, error=NULL, scheduled_at=? WHERE id=?").run(Date.now(), Number(id))
  return NextResponse.json({ ok: true })
}
