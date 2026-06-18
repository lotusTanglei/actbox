// src/app/api/send/route.ts — 发送邮件(按 accountId 取发件适配器)

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { accounts, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAdapter, listActiveAccountIds, ensureBootstrapAccount } from '@/lib/adapter/mail/adapterRegistry'

/** POST /api/send — 发送邮件(🔒 需人工确认后才调用)
 *  body: { to, subject, body, bodyHtml?, cc?, bcc?, replyToMessageId?, accountId? }
 *  accountId 缺省时用第一个启用账号。 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, body: mailBody, bodyHtml, replyToMessageId, cc, bcc, accountId } = body

    if (!to || !subject || !mailBody) {
      return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 })
    }

    const db = getDb()
    ensureBootstrapAccount(db)

    // 选定发件账号:指定 accountId > 第一个启用账号
    let accId = typeof accountId === 'number' ? accountId : null
    if (!accId) {
      const ids = listActiveAccountIds(db)
      if (ids.length === 0) {
        return NextResponse.json({ error: '没有可用发件账号,请先在设置中添加' }, { status: 400 })
      }
      accId = ids[0]
    }

    const adapter = getAdapter(accId, { db })
    if (!adapter) {
      return NextResponse.json({ error: '发件账号不可用' }, { status: 400 })
    }

    const result = await adapter.send({ to, cc, bcc, subject, body: mailBody, bodyHtml, replyToMessageId })

    const row = db.select().from(accounts).where(eq(accounts.id, accId)).all()[0] as any
    db.insert(messages)
      .values({
        messageId: result.messageId,
        subject,
        from: row?.user || row?.email || '',
        to,
        cc: cc || null,
        bcc: bcc || null,
        body: mailBody,
        bodyHtml: bodyHtml || null,
        direction: 'out',
        isRead: true,
        accountId: accId,
        folder: 'Sent',
      })
      .run()

    return NextResponse.json({ ok: true, messageId: result.messageId, accountId: accId })
  } catch (error) {
    console.error('[/api/send] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
