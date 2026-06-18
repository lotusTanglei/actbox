// src/__tests__/security/external.test.ts
import { describe, it, expect } from 'vitest'
import { isExternalSender, domainOf } from '@/lib/security/external'

describe('isExternalSender', () => {
  it('同域 → false', () => { expect(isExternalSender('Alice <alice@company.com>', 'me@company.com')).toBe(false) })
  it('不同域 → true', () => { expect(isExternalSender('spoofer@evil.com', 'me@company.com')).toBe(true) })
  it('无域名 → true', () => { expect(isExternalSender('nobody', 'me@company.com')).toBe(true) })
  it('多组织域', () => { expect(isExternalSender('a@corp.com', 'me@company.com', ['company.com', 'corp.com'])).toBe(false) })
})

describe('domainOf', () => {
  it('提取 email 域', () => { expect(domainOf('Alice <alice@example.com>')).toBe('example.com') })
  it('裸 email', () => { expect(domainOf('bob@x.com')).toBe('x.com') })
  it('无 email → 空串', () => { expect(domainOf('no email')).toBe('') })
})
