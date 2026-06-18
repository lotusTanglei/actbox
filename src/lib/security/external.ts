// src/lib/security/external.ts — 组织外部发件人标识。plan-11 Task 5。
export function domainOf(from: string): string { const m = (from || '').match(/([^\s@<>]+)@([^\s@<>]+)/i); return m ? m[2].toLowerCase() : '' }
export function isExternalSender(from: string, accountEmail: string, orgDomains?: string[]): boolean {
  const senderDomain = domainOf(from); if (!senderDomain) return true
  const trusted = new Set([domainOf(accountEmail), ...(orgDomains || [])].filter(Boolean))
  return !trusted.has(senderDomain)
}
