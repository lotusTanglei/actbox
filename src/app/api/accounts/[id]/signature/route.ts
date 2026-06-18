// src/app/api/accounts/[id]/signature/route.ts — 账号签名分配
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const row = getRawDb().prepare('SELECT signature_id FROM accounts WHERE id=?').get(Number(id)) as any
    if (!row) return NextResponse.json({ error: 'account not found' }, { status: 404 })
    if (!row.signature_id) return NextResponse.json({ signatureId: null })
    const sig = getRawDb().prepare('SELECT * FROM signatures WHERE id=?').get(row.signature_id)
    return NextResponse.json({ signatureId: row.signature_id, signature: sig })
  } catch {
    // accounts 表无 signature_id 列 → KV fallback
    const v = getRawDb().prepare("SELECT value FROM settings WHERE key=?").get(`account_sig_${id}`) as any
    const sigId = v ? Number(v.value) : null
    if (!sigId) return NextResponse.json({ signatureId: null })
    const sig = getRawDb().prepare('SELECT * FROM signatures WHERE id=?').get(sigId)
    return NextResponse.json({ signatureId: sigId, signature: sig })
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { signatureId } = await req.json()
  try {
    getRawDb().prepare('UPDATE accounts SET signature_id=? WHERE id=?').run(signatureId ?? null, Number(id))
  } catch {
    getRawDb().prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(`account_sig_${id}`, String(signatureId ?? ''))
  }
  return NextResponse.json({ ok: true })
}
