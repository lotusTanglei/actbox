// src/lib/security/pipeline.ts — 安全流水线入口。plan-11 Task 7。
import { sanitizeEmailHtml } from './sanitize'
import { scoreSpam, type SpamContext, type SpamVerdict } from './spam'
import { parseAuthHeaders, type AuthResult } from './auth-headers'
import { isExternalSender } from './external'

export interface SecurityPipelineResult { spam: SpamVerdict; auth: AuthResult; isExternal: boolean; sanitized: boolean }

export async function applySecurityToIngestedMessage(db: any, args: {
  messageRow: { id: number; sender?: string; subject?: string; body?: string; body_html?: string; received_at?: number }
  headers: Record<string, string>
  accountEmail: string
  moveSpamToFolder: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void>
  spamThreshold?: number
  orgDomains?: string[]
  whitelistSenders?: string[]
  extraSpamWords?: string[]
}): Promise<SecurityPipelineResult> {
  const { messageRow, headers, accountEmail, moveSpamToFolder } = args
  const id = messageRow.id

  const rawHtml = messageRow.body_html ?? ''
  const safeHtml = sanitizeEmailHtml(rawHtml)
  if (safeHtml !== rawHtml) db.prepare('UPDATE messages SET body_html = ? WHERE id = ?').run(safeHtml, id)

  const spamCtx: SpamContext = {
    from: messageRow.sender ?? '', subject: messageRow.subject ?? '', bodyText: messageRow.body ?? '',
    bodyHtml: safeHtml, date: messageRow.received_at ? new Date(messageRow.received_at).toISOString() : null,
    messageId: null, hasAttachment: false, receivedHeader: headers['received'] || headers['Received'] || '',
  }
  const spam = scoreSpam(spamCtx, { threshold: args.spamThreshold, whitelistSenders: args.whitelistSenders, extraSpamWords: args.extraSpamWords })
  db.prepare('UPDATE messages SET spam_score = ?, spam_reasons = ?, is_spam = ? WHERE id = ?').run(spam.score, JSON.stringify(spam.reasons), spam.isSpam ? 1 : 0, id)
  if (spam.isSpam) await moveSpamToFolder(db, { messageIds: [id], targetFolder: 'Spam' })

  const auth = parseAuthHeaders(headers)
  db.prepare('UPDATE messages SET auth_result = ? WHERE id = ?').run(JSON.stringify(auth), id)

  const external = isExternalSender(messageRow.sender ?? '', accountEmail, args.orgDomains)
  db.prepare('UPDATE messages SET is_external = ? WHERE id = ?').run(external ? 1 : 0, id)

  return { spam, auth, isExternal: external, sanitized: true }
}
