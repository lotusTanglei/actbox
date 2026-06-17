// src/app/api/send/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { MailSender } from '@/lib/adapter/mail'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'

/** POST /api/send — 发送邮件（🔒 需人工确认后才调用） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, body: mailBody, bodyHtml, replyToMessageId } = body

    if (!to || !subject || !mailBody) {
      return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 })
    }

    const sender = new MailSender()
    const result = await sender.send({ to, subject, body: mailBody, bodyHtml, replyToMessageId })

    // 记录到已发送（含 HTML 正文）
    const db = getDb()
    db.insert(messages).values({
      messageId: result.messageId,
      subject,
      from: process.env.IMAP_USER || '',
      to,
      body: mailBody,
      bodyHtml: bodyHtml || null,
      direction: 'out',
      isRead: true,
    }).run()

    return NextResponse.json({ ok: true, messageId: result.messageId })
  } catch (error) {
    console.error('[/api/send] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
