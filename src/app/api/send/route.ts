// src/app/api/send/route.ts — 发送邮件(按 accountId 取发件适配器)

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { getDb, getRawDb } from '@/lib/db'
import { accounts, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAdapter, listActiveAccountIds, ensureBootstrapAccount } from '@/lib/adapter/mail/adapterRegistry'
import { getAttachmentsRoot } from '@/lib/attachments/store'
import { splitAddresses, validateRecipients } from '@/lib/mail/recipients'
import { buildForward } from '@/lib/mail/forward'

/** 把客户端传来的相对 storagePath 解析为绝对路径,且必须落在 attachments/tmp/ 内(防穿越,避免 nodemailer 读任意文件)。 */
function resolveAttachmentPath(storagePath: string): string {
  const root = getAttachmentsRoot()
  const full = path.resolve(root, storagePath)
  const tmpDir = path.resolve(root, 'attachments', 'tmp')
  if (!full.startsWith(tmpDir + path.sep)) {
    throw new Error('非法附件路径')
  }
  return full
}

/** POST /api/send — 发送邮件(🔒 需人工确认后才调用)
 *  body: { to, subject, body, bodyHtml?, cc?, bcc?, replyToMessageId?, accountId? }
 *  accountId 缺省时用第一个启用账号。 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, body: mailBody, bodyHtml, replyToMessageId, cc, bcc, accountId, attachments, forwardOfMessageId } = body

    // 收件人校验(to/cc/bcc 合并)
    const allAddrs = [...splitAddresses(to || ''), ...splitAddresses(cc || ''), ...splitAddresses(bcc || '')]
    const { invalid } = validateRecipients(allAddrs)
    if (invalid.length) {
      return NextResponse.json({ error: '非法收件人地址', invalid }, { status: 400 })
    }

    if (!to || !subject || !mailBody) {
      return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 })
    }

    // 待发附件:外联给 storagePath(解析绝对路径),内联给 cid。校验路径不逃出 attachments/tmp/
    let sendAttachments: { filename: string; path?: string; cid?: string }[] | undefined
    if (Array.isArray(attachments) && attachments.length) {
      sendAttachments = []
      for (const a of attachments) {
        const att: { filename: string; path?: string; cid?: string } = { filename: String(a?.filename ?? 'attachment') }
        if (a?.storagePath) {
          try {
            att.path = resolveAttachmentPath(String(a.storagePath))
          } catch {
            return NextResponse.json({ error: '非法附件路径' }, { status: 400 })
          }
        }
        if (a?.cid) att.cid = String(a.cid)
        sendAttachments.push(att)
      }
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

    // 转发:加载源邮件 → buildForward 取头(subject/body 已由 compose 预填,此处补 Auto-Submitted/References)
    let fwdHeaders: Record<string, string> | undefined
    if (forwardOfMessageId) {
      const src = getRawDb()
        .prepare(`SELECT message_id, subject, sender AS "from", "to", body, received_at FROM messages WHERE message_id = ?`)
        .get(forwardOfMessageId) as
        | { message_id: string; subject: string | null; from: string | null; to: string | null; body: string | null; received_at: number | null }
        | undefined
      if (src) {
        fwdHeaders = buildForward(
          {
            messageId: src.message_id || '',
            subject: src.subject || '',
            from: src.from || '',
            to: src.to || '',
            body: src.body || '',
            receivedAt: src.received_at ? new Date(src.received_at * 1000) : null,
          },
          { accountId: accId },
        ).headers
      }
    }

    const result = await adapter.send({ to, cc, bcc, subject, body: mailBody, bodyHtml, replyToMessageId, attachments: sendAttachments, headers: fwdHeaders })

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
