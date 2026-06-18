// src/lib/security/auth-headers.ts — SPF/DKIM/DMARC + 钓鱼链接扫描。plan-11 Task 4。
export type AuthStatus = 'pass' | 'fail' | 'softfail' | 'none'
export interface AuthResult { spf: AuthStatus; dkim: AuthStatus; dmarc: AuthStatus; raw: string }
export interface LinkInfo { href: string; text: string }
export interface PhishingWarning { href: string; reason: 'BARE_IP' | 'PUNYCODE' | 'MISMATCHED_URL' | 'SHORT_LINK' }

function lookup(headers: Record<string, string>, key: string): AuthStatus {
  const v = headers['authentication-results'] || headers['Authentication-Results'] || ''
  const m = v.match(new RegExp(`${key}\\s*=\\s*(pass|fail|softfail|none|temperror|permerror|neutral)`, 'i'))
  if (!m) return 'none'
  const s = m[1].toLowerCase()
  if (s === 'pass') return 'pass'
  if (s === 'fail' || s === 'permerror') return 'fail'
  if (s === 'softfail' || s === 'neutral' || s === 'temperror') return 'softfail'
  return 'none'
}

export function parseAuthHeaders(headers: Record<string, string>): AuthResult {
  const raw = headers['authentication-results'] || headers['Authentication-Results'] || headers['Received-SPF'] || ''
  return { spf: lookup(headers, 'spf'), dkim: lookup(headers, 'dkim'), dmarc: lookup(headers, 'dmarc'), raw }
}

export function extractLinks(html: string): LinkInfo[] {
  if (!html) return []
  const out: LinkInfo[] = []
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push({ href: m[1], text: (m[2] || '').replace(/<[^>]+>/g, '').trim() })
  return out
}

function hostOf(url: string): string { try { return new URL(url).hostname.toLowerCase() } catch { return '' } }

export function isPhishing(links: LinkInfo[]): PhishingWarning[] {
  const warnings: PhishingWarning[] = []
  for (const l of links) {
    const host = hostOf(l.href)
    if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(host)) warnings.push({ href: l.href, reason: 'BARE_IP' })
    if (host.includes('xn--')) warnings.push({ href: l.href, reason: 'PUNYCODE' })
    const textHost = hostOf(l.text.startsWith('http') ? l.text : `http://${l.text}`)
    if (textHost && host && textHost !== host) warnings.push({ href: l.href, reason: 'MISMATCHED_URL' })
    if (/bit\.ly|t\.co|tinyurl|goo\.gl/i.test(host)) warnings.push({ href: l.href, reason: 'SHORT_LINK' })
  }
  return warnings
}
