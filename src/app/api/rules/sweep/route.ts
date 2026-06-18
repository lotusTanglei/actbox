// src/app/api/rules/sweep/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb, getDb } from '@/lib/db'
import { inboxSweep } from '@/lib/rules/sweep'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'
import { applyAction } from '@/lib/sync/writeback'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.accountId || !b.fromEmail) return NextResponse.json({ error: 'accountId + fromEmail required' }, { status: 400 })
  const db = getRawDb()
  const adapter = getAdapter(b.accountId, { db: getDb() })
  const boundApplyAction = (d: any, opts: any) => applyAction(d, { ...opts, adapter })
  const res = await inboxSweep(db, { accountId: b.accountId, fromEmail: b.fromEmail, keep: b.keep, applyAction: boundApplyAction })
  return NextResponse.json(res)
}
