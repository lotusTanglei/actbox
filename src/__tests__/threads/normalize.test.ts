// src/__tests__/threads/normalize.test.ts
// TDD: Subject 规范化 + In-Reply-To/References 根提取。plan-08 Task 2。

import { describe, it, expect } from 'vitest'
import { normalizeSubject, extractRootMessageId } from '@/lib/threads/normalize'

describe('normalizeSubject', () => {
  it('去除 Re:/Fwd:/Fw: 前缀（多层）并折叠空白/大小写', () => {
    expect(normalizeSubject('Re: Re: 周报')).toBe('周报')
    expect(normalizeSubject('Fwd: Fw: RE: Weekly Report')).toBe('weekly report')
    expect(normalizeSubject('  [External] Re: Hello  ')).toBe('[external] hello')
  })
  it('空/null → 空串', () => {
    expect(normalizeSubject(null as any)).toBe('')
    expect(normalizeSubject('')).toBe('')
  })
})

describe('extractRootMessageId', () => {
  it('References 取第一个（最老）作为根', () => {
    expect(extractRootMessageId({ inReplyTo: '<b@x>', references: '<a@x> <b@x>' })).toBe('a@x')
  })
  it('无 References 则用 In-Reply-To', () => {
    expect(extractRootMessageId({ inReplyTo: '<b@x>', references: null })).toBe('b@x')
  })
  it('两者都无返回 null', () => {
    expect(extractRootMessageId({ inReplyTo: null, references: null })).toBeNull()
  })
  it('去尖括号', () => {
    expect(extractRootMessageId({ inReplyTo: '  <c@d>  ', references: null })).toBe('c@d')
  })
})
