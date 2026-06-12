// src/lib/adapter/mail/receiver.ts

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { cleanEmailBody } from './cleaner'
import type { RawMessage } from '../types'

interface MailConfig {
  host: string
  port: number
  user: string
  authCode: string
}

export class MailReceiver {
  private config: MailConfig

  constructor(config?: Partial<MailConfig>) {
    this.config = {
      host: config?.host || process.env.IMAP_HOST || 'imap.163.com',
      port: config?.port || parseInt(process.env.IMAP_PORT || '993'),
      user: config?.user || process.env.IMAP_USER || '',
      authCode: config?.authCode || process.env.IMAP_AUTH_CODE || '',
    }
  }

  /**
   * 拉取最近的未读邮件（最多 limit 封）
   */
  async fetchRecent(limit = 10): Promise<RawMessage[]> {
    if (!this.config.user || !this.config.authCode) {
      throw new Error('IMAP 未配置: 请在 .env.local 中设置 IMAP_USER 和 IMAP_AUTH_CODE')
    }

    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: {
        user: this.config.user,
        pass: this.config.authCode,
      },
      logger: false as any,
    })

    const result: RawMessage[] = []

    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')

      try {
        // 搜索未读邮件
        const uids = await client.search({ seen: false }, { uid: true })

        if (!uids || !Array.isArray(uids) || uids.length === 0) {
          return []
        }

        // 取最近的 limit 封（UID 倒序）
        const toFetch = uids.slice(-limit).reverse()

        for await (const msg of client.fetch(toFetch, { source: true })) {
          if (!msg.source) continue

          // 用 mailparser 解析 MIME
          const parsed = await simpleParser(msg.source)

          const from = parsed.from?.text || '未知'
          const subject = parsed.subject || '(无主题)'
          const messageId = parsed.messageId || ''

          const body = cleanEmailBody(
            parsed.html || undefined,
            parsed.text || undefined
          )

          result.push({
            source: 'email',
            messageId,
            subject,
            from,
            body,
            receivedAt: parsed.date || new Date(),
          })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    return result
  }
}
