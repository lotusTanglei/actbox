// src/lib/adapter/mail/imapAdapter.ts
// IMAP 适配器：实现 MailAdapter。合并并重构旧 receiver.ts（收）+ sender.ts（发）。
// 关键修正：fetch 用 folder + UIDVALIDITY + UID（不再用 sequence number）做增量，
// 呼应 commit a1967ac 的教训（sequence 在 expunge 后重排，多账号增量不可靠）。
// 构造函数接受 clientFactory / transporterFactory 注入，便于单测。

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { cleanEmailBody } from './cleaner'
import type { AccountConfig, FolderInfo, MailAdapter, RawMessage, SendParams } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any

export interface ImapAdapterInject {
  clientFactory?: (cfg: { host: string; port: number; user: string; pass: string }) => Promise<AnyClient> | AnyClient
  transporterFactory?: (cfg: { host: string; port: number; user: string; pass: string }) => any
}

export class ImapAdapter implements MailAdapter {
  constructor(
    private cfg: AccountConfig,
    private inject?: ImapAdapterInject,
  ) {}

  private imapCfg() {
    return { host: this.cfg.imapHost, port: this.cfg.imapPort, user: this.cfg.user, pass: this.cfg.authCode }
  }
  private smtpCfg() {
    return { host: this.cfg.smtpHost, port: this.cfg.smtpPort, user: this.cfg.user, pass: this.cfg.authCode }
  }

  private async makeClient(): Promise<AnyClient> {
    if (this.inject?.clientFactory) return await this.inject.clientFactory(this.imapCfg())
    return new ImapFlow({ ...this.imapCfg(), secure: true, logger: false })
  }

  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const client = await this.makeClient()
      await client.connect()
      await client.logout()
      return { ok: true, detail: '连接成功' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  async listFolders(): Promise<FolderInfo[]> {
    const client = await this.makeClient()
    try {
      await client.connect()
      const list = ((await client.list()) as any[]) || []
      return list
        .filter((b) => !(b.flags && Array.from(b.flags).includes('\\Noselect')))
        .map((b) => ({
          path: b.path,
          displayName: b.name || b.path,
          type: classifyFolder(b.path, b.flags),
          totalCount: b.status?.total,
          unreadCount: b.status?.unseen,
        }))
    } finally {
      await safeLogout(client)
    }
  }

  async fetch(opts: { folder: string; since?: Date; uidRange?: [number, number] }): Promise<RawMessage[]> {
    const client = await this.makeClient()
    const result: RawMessage[] = []
    try {
      await client.connect()
      const lock = await client.getMailboxLock(opts.folder)
      try {
        // UID 范围优先（增量同步）；否则 since；否则未读（回退全部）
        let uids: number[]
        if (opts.uidRange) {
          const [from, to] = opts.uidRange
          uids = await client.search({ uid: { gte: from, lte: to } })
        } else if (opts.since) {
          uids = await client.search({ since: opts.since })
        } else {
          uids = await client.search({ seen: false })
          if (!uids?.length) uids = await client.search({ all: true })
        }
        if (!uids?.length) return []

        for await (const msg of client.fetch(uids, { source: true, uid: true, internalDate: true })) {
          if (!msg.source) continue
          const parsed = await simpleParser(msg.source)
          result.push({
            messageId: parsed.messageId || '',
            subject: parsed.subject || null,
            from: parsed.from?.text || null,
            to: addrText(parsed.to),
            cc: addrText(parsed.cc),
            bcc: addrText(parsed.bcc),
            body: cleanEmailBody(parsed.html || undefined, parsed.text || undefined),
            bodyHtml: parsed.html || null,
            receivedAt: parsed.date || null,
            accountId: this.cfg.id,
            folder: opts.folder,
            imapUid: msg.uid ?? undefined,
          })
        }
      } finally {
        await lock.release()
      }
    } finally {
      await safeLogout(client)
    }
    return result
  }

  async send(params: SendParams): Promise<{ messageId: string; imapUid?: number }> {
    const transporter = this.inject?.transporterFactory
      ? this.inject.transporterFactory(this.smtpCfg())
      : nodemailer.createTransport({
          host: this.cfg.smtpHost,
          port: this.cfg.smtpPort,
          secure: true,
          auth: { user: this.cfg.user, pass: this.cfg.authCode },
        })

    const result = await transporter.sendMail({
      from: this.cfg.user,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.body,
      html: params.bodyHtml,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        path: a.path,
        content: a.content,
        cid: a.cid,
      })),
      headers: params.replyToMessageId
        ? { 'In-Reply-To': params.inReplyTo || params.replyToMessageId, References: params.replyToMessageId }
        : undefined,
    })
    return { messageId: result.messageId }
  }

  async move(uid: number, fromFolder: string, toFolder: string): Promise<void> {
    await this.withLock(fromFolder, (client) => client.messageMove(uid, toFolder, { uid: true }))
  }

  async markRead(uid: number, folder: string, isRead: boolean): Promise<void> {
    await this.withLock(folder, (client) =>
      isRead
        ? client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        : client.messageFlagsRemove(uid, ['\\Seen'], { uid: true }),
    )
  }

  async delete(uid: number, folder: string): Promise<void> {
    await this.withLock(folder, (client) => client.messageDelete(uid, { uid: true }))
  }

  private async withLock(folder: string, fn: (client: AnyClient) => Promise<void>): Promise<void> {
    const client = await this.makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folder)
      try {
        await fn(client)
      } finally {
        await lock.release()
      }
    } finally {
      await safeLogout(client)
    }
  }
}

function classifyFolder(path: string, flags?: Set<string> | string[]): FolderInfo['type'] {
  const f = new Set(Array.from(flags || []) as string[])
  const p = (path || '').toUpperCase()
  if (f.has('\\Inbox') || p === 'INBOX') return 'inbox'
  if (f.has('\\Sent')) return 'sent'
  if (f.has('\\Drafts')) return 'drafts'
  if (f.has('\\Trash')) return 'trash'
  if (f.has('\\Junk') || f.has('\\Spam')) return 'spam'
  if (f.has('\\Archive') || f.has('\\All')) return 'archive'
  return 'custom'
}

async function safeLogout(client: AnyClient) {
  try {
    await client.logout()
  } catch {
    /* ignore */
  }
}

/** mailparser 的 to/cc/bcc 可能是 AddressObject | AddressObject[]，统一取 text */
function addrText(a: any): string | null {
  if (!a) return null
  if (Array.isArray(a)) return a.map((x: any) => x?.text).filter(Boolean).join(', ') || null
  return a.text || null
}
