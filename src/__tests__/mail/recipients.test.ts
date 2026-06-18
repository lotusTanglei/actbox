// src/__tests__/mail/recipients.test.ts

import { describe, it, expect } from 'vitest'
import {
  splitAddresses,
  validateRecipients,
  findExternalDomains,
  detectAttachmentMention,
} from '@/lib/mail/recipients'

describe('收件人处理', () => {
  it('splitAddresses 按逗号/分号拆并 trim,过滤空', () => {
    expect(splitAddresses('a@x.com, b@y.com; ,')).toEqual(['a@x.com', 'b@y.com'])
    expect(splitAddresses('')).toEqual([])
    expect(splitAddresses('  one@x.com  ')).toEqual(['one@x.com'])
  })

  it('validateRecipients 标非法地址', () => {
    expect(validateRecipients(['a@x.com', 'not-email', 'b@y.com'])).toEqual({
      valid: ['a@x.com', 'b@y.com'],
      invalid: ['not-email'],
    })
  })

  it('findExternalDomains 对比账号自有域标外部', () => {
    expect(findExternalDomains(['cowork@a.com', 'stranger@evil.com'], ['a.com'])).toEqual([
      'stranger@evil.com',
    ])
  })

  it('detectAttachmentMention 文本提到附件但列表空 → true', () => {
    expect(detectAttachmentMention('见附件', [])).toBe(true)
    expect(detectAttachmentMention('见附件', [{ filename: 'a.pdf' }])).toBe(false)
    expect(detectAttachmentMention('please find attached the doc', [])).toBe(true)
    expect(detectAttachmentMention('hello', [])).toBe(false)
  })
})
