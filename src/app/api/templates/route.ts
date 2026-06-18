// src/app/api/templates/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { extractVariables } from '@/lib/templates/render'

export async function GET(req: NextRequest) {
  const db = getRawDb()
  const acct = new URL(req.url).searchParams.get('accountId')
  const rows = acct
    ? db.prepare('SELECT * FROM templates WHERE account_id=? OR account_id IS NULL ORDER BY name').all(Number(acct))
    : db.prepare('SELECT * FROM templates ORDER BY name').all()
  const templates = (rows as any[]).map((r) => ({ ...r, variables: r.variables ? JSON.parse(r.variables) : [] }))
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name || !body.bodyHtml) {
    return NextResponse.json({ error: 'Missing name or bodyHtml' }, { status: 400 })
  }
  const variables = Array.isArray(body.variables) && body.variables.length > 0
    ? body.variables
    : extractVariables(body.bodyHtml)
  const db = getRawDb()
  const res = db.prepare(
    'INSERT INTO templates (account_id, name, body_html, variables) VALUES (?,?,?,?)'
  ).run(body.accountId ?? null, body.name, body.bodyHtml, JSON.stringify(variables))
  const row = db.prepare('SELECT * FROM templates WHERE id=?').get(res.lastInsertRowid) as any
  return NextResponse.json({ template: { ...row, variables } }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  getRawDb().prepare('DELETE FROM templates WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
