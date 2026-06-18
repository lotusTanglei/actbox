// src/app/api/signatures/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function GET() {
  const rows = getRawDb().prepare('SELECT * FROM signatures ORDER BY name').all()
  return NextResponse.json({ signatures: rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  const db = getRawDb()
  const now = Date.now()
  const r = db.prepare('INSERT INTO signatures (name, body_html, body_text, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(body.name, body.bodyHtml || null, body.bodyText || null, now, now)
  const row = db.prepare('SELECT * FROM signatures WHERE id=?').get(Number(r.lastInsertRowid))
  return NextResponse.json({ signature: row }, { status: 201 })
}
