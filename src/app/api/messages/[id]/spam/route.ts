// src/app/api/messages/[id]/spam/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb, getDb } from '@/lib/db'
import { markAsSpam, unmarkSpam, reportSpam } from '@/lib/security/spam-repo'
import { applyAction } from '@/lib/sync/writeback'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json()
  const db = getRawDb()
  const m = db.prepare('SELECT account_id FROM messages WHERE id = ?').get(Number(id)) as any
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const move = (d: any, opts: any) => applyAction(d, { ...opts, adapter: getAdapter(m.account_id, { db: getDb() }) })
  if (b.action === 'mark') await markAsSpam(db, { messageId: Number(id), moveToSpam: move })
  else if (b.action === 'unmark') await unmarkSpam(db, { messageId: Number(id), moveToFolder: move })
  else if (b.action === 'report') await reportSpam(db, { messageId: Number(id), moveToSpam: move })
  else return NextResponse.json({ error: 'action must be mark|unmark|report' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
