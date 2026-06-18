// src/__tests__/attachments/sanitize.test.ts

import { describe, it, expect } from 'vitest'
import { sanitizeFilename, isWithinSizeLimit, isZipBombRisk } from '@/lib/attachments/sanitize'

describe('附件安全', () => {
  it('剥离路径穿越 ../ 与绝对路径', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('/etc/shadow')).toBe('shadow')
    expect(sanitizeFilename('a/../../b.txt')).toBe('b.txt')
  })
  it('反斜杠分隔也按路径剥离', () => {
    expect(sanitizeFilename('a\\..\\..\\b.txt')).toBe('b.txt')
    expect(sanitizeFilename('C:\\Windows\\system32\\x.dll')).toBe('x.dll')
  })
  it('控制字符/空名兜底', () => {
    expect(sanitizeFilename('')).toBe('attachment')
    expect(sanitizeFilename('   ')).toBe('attachment')
    expect(sanitizeFilename('a\x00b.txt')).toBe('ab.txt')
  })
  it('保留正常多语言名', () => {
    expect(sanitizeFilename('报告.pdf')).toBe('报告.pdf')
  })
  it('isWithinSizeLimit', () => {
    expect(isWithinSizeLimit(25 * 1024 * 1024, { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 })).toBe(true)
    expect(isWithinSizeLimit(25 * 1024 * 1024 + 1, { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 })).toBe(false)
  })
  it('ZIP 炸弹检测：压缩比 > 100 标记风险', () => {
    expect(isZipBombRisk({ compressedSize: 1024, uncompressedSize: 200 * 1024 })).toBe(true)
    expect(isZipBombRisk({ compressedSize: 1024, uncompressedSize: 50 * 1024 })).toBe(false)
  })
  it('compressedSize=0 不误报', () => {
    expect(isZipBombRisk({ compressedSize: 0, uncompressedSize: 999999 })).toBe(false)
  })
})
