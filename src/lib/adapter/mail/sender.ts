// src/lib/adapter/mail/sender.ts

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

interface SmtpConfig {
  host: string
  port: number
  user: string
  authCode: string
}

export class MailSender {
  private config: SmtpConfig

  constructor(config?: Partial<SmtpConfig>) {
    this.config = {
      host: config?.host || process.env.SMTP_HOST || 'smtp.163.com',
      port: config?.port || parseInt(process.env.SMTP_PORT || '465'),
      user: config?.user || process.env.IMAP_USER || '',
      authCode: config?.authCode || process.env.IMAP_AUTH_CODE || '',
    }
  }

  /**
   * 发送邮件
   * 🔒 安全铁律：此函数只发送，不自动调用。必须人工确认后才调用。
   */
  async send(params: {
    to: string
    subject: string
    body: string
    bodyHtml?: string
    replyToMessageId?: string
  }): Promise<{ messageId: string }> {
    if (!this.config.user || !this.config.authCode) {
      throw new Error('SMTP 未配置: 请设置 IMAP_USER 和 IMAP_AUTH_CODE')
    }

    const transporter: Transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: {
        user: this.config.user,
        pass: this.config.authCode,
      },
    })

    const result = await transporter.sendMail({
      from: this.config.user,
      to: params.to,
      subject: params.subject,
      text: params.body,
      html: params.bodyHtml,
      headers: params.replyToMessageId
        ? { 'In-Reply-To': params.replyToMessageId, References: params.replyToMessageId }
        : undefined,
    })

    return { messageId: result.messageId }
  }
}
