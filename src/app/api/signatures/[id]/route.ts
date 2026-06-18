// src/app/api/signatures/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const row = getRawDb().prepare('SELECT * FROM signatures WHERE id=?').get(Number(id))
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ signature: row })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()
  const db = getRawDb()
  const sets: string[] = []; const params: any[] = []
  if (body.name !== undefined) { sets.push('name=?'); params.push(body.name) }
  if (body.bodyHtml !== undefined) { sets.push('body_html=?'); params.push(body.bodyHtml) }
  if (body.bodyText !== undefined) { sets.push('body_text=?'); params.push(body.bodyText) }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  sets.push('updated_at=?'); params.push(Date.now()); params.push(Number(id))
  db.prepare(`UPDATE signatures SET ${sets.join(',')} WHERE id=?`).run(...params)
  const row = db.prepare('SELECT * FROM signatures WHERE id=?').get(Number(id))
  return NextResponse.json({ signature: row })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  getRawDb().prepare('DELETE FROM signatures WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
