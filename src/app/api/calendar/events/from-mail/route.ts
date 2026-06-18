// src/app/api/calendar/events/from-mail/route.ts — 邮件→事件草稿
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { mailToEventDraft, mailToTodoDraft } from '@/lib/calendar/convert'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const db = getRawDb()
  const m = db.prepare('SELECT message_id, subject, sender, body FROM messages WHERE id=?').get(Number(body.messageId)) as any
  if (!m) return NextResponse.json({ error: 'message not found' }, { status: 404 })
  return NextResponse.json({
    eventDraft: mailToEventDraft({ messageId: m.message_id, subject: m.subject, from: m.sender, body: m.body }),
    todoDraft: mailToTodoDraft({ messageId: m.message_id, subject: m.subject, from: m.sender, body: m.body }),
  })
}
