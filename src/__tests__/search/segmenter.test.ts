// src/__tests__/search/segmenter.test.ts

import { describe, it, expect } from 'vitest'
import { segment, tokenizeQuery } from '@/lib/search/segmenter'

describe('jieba 分词', () => {
  it('中文切词后空格连接', () => {
    const s = segment('发票报销流程')
    expect(s).toContain('发票')
    expect(s).toContain('报销')
  })

  it('英文短语保持词形、按空格分', () => {
    expect(segment('quarterly report')).toContain('quarterly')
    expect(segment('quarterly report')).toContain('report')
  })

  it('空串/纯空白返回空串', () => {
    expect(segment('')).toBe('')
    expect(segment('   ')).toBe('')
  })

  it('tokenizeQuery 去多余空白 + 小写', () => {
    expect(tokenizeQuery('  Foo  BAR ')).toBe('foo bar')
  })
})
