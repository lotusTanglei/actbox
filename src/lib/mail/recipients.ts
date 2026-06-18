// src/lib/mail/recipients.ts
// 收件人解析/校验:拆列、RFC 简化邮箱校验、外部域提醒、"提到附件但未添加"检测。plan-05 Task 2。

/** 按逗号/分号拆地址并 trim,去空。 */
export function splitAddresses(s: string): string[] {
  if (!s) return []
  return s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

// RFC 简化邮箱正则(够用,非全量 RFC 5322):local@domain,允许无 TLD 的本地/内网域(如 b@y)。
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/

export interface ValidationResult {
  valid: string[]
  invalid: string[]
}

/** 校验收件人列表,分 valid/invalid。 */
export function validateRecipients(addrs: string[]): ValidationResult {
  const valid: string[] = []
  const invalid: string[] = []
  for (const a of addrs) {
    if (EMAIL_RE.test(a)) valid.push(a)
    else invalid.push(a)
  }
  return { valid, invalid }
}

function domainOf(addr: string): string {
  const at = addr.lastIndexOf('@')
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : ''
}

/** 域名不在 ownDomains 的收件人视为外部。 */
export function findExternalDomains(addrs: string[], ownDomains: string[]): string[] {
  const own = new Set(ownDomains.map((d) => d.toLowerCase()))
  return addrs.filter((a) => {
    const d = domainOf(a)
    return d !== '' && !own.has(d)
  })
}

const ATTACH_KEYWORDS = /附件|见附件|附件中|attached|attachment|enclosed|随信附/i

/** 文本提到附件关键词但附件列表为空 → true(提醒用户)。 */
export function detectAttachmentMention(text: string, attachments: { filename: string }[]): boolean {
  if (!text) return false
  if (attachments.length > 0) return false
  return ATTACH_KEYWORDS.test(text)
}
