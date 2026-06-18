// src/lib/mail/forward.ts
// 构造转发:引用原文块 + Auto-Submitted/References/In-Reply-To 头。plan-05 Task 4。

export interface ForwardSource {
  messageId: string
  subject: string
  from: string
  to: string
  body: string
  receivedAt: Date | null
}

export interface ForwardResult {
  subject: string
  body: string
  headers: Record<string, string>
}

/**
 * @param _opts.accountId 预留(签名在 compose 编辑层注入,非此函数)
 */
export function buildForward(src: ForwardSource, _opts: { accountId: number }): ForwardResult {
  const subj = src.subject || ''
  const subject = /^(fwd|fw):\s*/i.test(subj) ? subj : `Fwd: ${subj}`
  const dateStr = src.receivedAt ? src.receivedAt.toUTCString() : ''

  const headerLines = [
    '-----原始邮件-----',
    `主题: ${subj}`,
    `发件人: ${src.from || ''}`,
    `收件人: ${src.to || ''}`,
    dateStr ? `时间: ${dateStr}` : '',
  ].filter(Boolean)
  const body = `${headerLines.join('\n')}\n\n${src.body || ''}`

  const headers: Record<string, string> = { 'Auto-Submitted': 'auto-replied' }
  if (src.messageId) {
    headers['References'] = src.messageId
    headers['In-Reply-To'] = src.messageId
  }
  return { subject, body, headers }
}
