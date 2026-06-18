// src/__tests__/security/auth-headers.test.ts
import { describe, it, expect } from 'vitest'
import { parseAuthHeaders, extractLinks, isPhishing } from '@/lib/security/auth-headers'

describe('parseAuthHeaders', () => {
  it('全 pass', () => { const r = parseAuthHeaders({ 'authentication-results': 'spf=pass dkim=pass dmarc=pass' }); expect(r.spf).toBe('pass'); expect(r.dkim).toBe('pass'); expect(r.dmarc).toBe('pass') })
  it('spf=fail', () => { const r = parseAuthHeaders({ 'authentication-results': 'spf=fail dkim=fail dmarc=fail' }); expect(r.spf).toBe('fail') })
  it('softfail', () => { const r = parseAuthHeaders({ 'authentication-results': 'spf=softfail dkim=none dmarc=none' }); expect(r.spf).toBe('softfail') })
  it('无头 → all none', () => { const r = parseAuthHeaders({}); expect(r.spf).toBe('none') })
})

describe('extractLinks + isPhishing', () => {
  it('extractLinks 抽 href', () => { expect(extractLinks('<a href="https://example.com">click</a>')[0].href).toBe('https://example.com') })
  it('裸 IP 警告', () => { expect(isPhishing(extractLinks('<a href="http://1.2.3.4/login">bank</a>')).some(x => x.reason === 'BARE_IP')).toBe(true) })
  it('Punycode 警告', () => { expect(isPhishing(extractLinks('<a href="http://xn--mller-kva.de">g</a>')).some(x => x.reason === 'PUNYCODE')).toBe(true) })
  it('域名不一致 警告', () => { expect(isPhishing(extractLinks('<a href="http://evil.com">https://google.com</a>')).some(x => x.reason === 'MISMATCHED_URL')).toBe(true) })
  it('正常链接无警告', () => { expect(isPhishing(extractLinks('<a href="https://example.com/path">example.com</a>'))).toHaveLength(0) })
})
