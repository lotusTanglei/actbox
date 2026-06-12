// src/__tests__/extractor/prompt.test.ts

import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/extractor/prompt'

describe('buildExtractionPrompt', () => {
  it('should include the email body', () => {
    const result = buildExtractionPrompt('这是一封测试邮件')
    expect(result).toContain('这是一封测试邮件')
  })

  it('should request JSON output format', () => {
    const result = buildExtractionPrompt('测试')
    expect(result).toContain('"todos"')
    expect(result).toContain('"title"')
    expect(result).toContain('"isActionable"')
  })

  it('should include Chinese-specific instructions', () => {
    const result = buildExtractionPrompt('测试')
    expect(result).toContain('截止')
    expect(result).toContain('委婉')
  })
})
