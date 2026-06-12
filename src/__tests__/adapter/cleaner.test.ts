// src/__tests__/adapter/cleaner.test.ts

import { describe, it, expect } from 'vitest'
import { cleanEmailBody } from '@/lib/adapter/mail/cleaner'

describe('cleanEmailBody', () => {
  it('should prefer plain text when available', () => {
    const result = cleanEmailBody(
      '<p>Hello</p>',
      'Plain text content here that is long enough to use'
    )
    expect(result).toBe('Plain text content here that is long enough to use')
  })

  it('should convert HTML to text', () => {
    const result = cleanEmailBody('<h1>标题</h1><p>内容段落</p>', undefined)
    expect(result).toContain('标题')
    expect(result).toContain('内容段落')
  })

  it('should remove quoted reply', () => {
    const text =
      '这是我的回复内容\n\n---原始邮件---\n发件人: 张三\n\n原始内容'
    const result = cleanEmailBody(undefined, text)
    expect(result).toContain('这是我的回复内容')
    expect(result).not.toContain('原始内容')
  })

  it('should return empty for no content', () => {
    const result = cleanEmailBody(undefined, undefined)
    expect(result).toBe('')
  })
})
