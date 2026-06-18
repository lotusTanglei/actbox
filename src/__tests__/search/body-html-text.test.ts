// src/__tests__/search/body-html-text.test.ts

import { describe, it, expect } from 'vitest'
import { htmlToText } from '@/lib/db/body-html-text'

describe('htmlToText', () => {
  it('去标签 + 解码实体 + 折叠空白', () => {
    expect(htmlToText('<p>Hello&nbsp;World</p>')).toBe('Hello World')
  })
  it('去 script/style 内容', () => {
    expect(htmlToText('<style>a{}</style><script>x()</script>hi')).toBe('hi')
  })
  it('解码常见实体', () => {
    expect(htmlToText('a&amp;b&lt;c&gt;d&quot;e')).toBe('a&b<c>d"e')
  })
  it('空/非字符串 → 空串', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText(null as unknown as string)).toBe('')
  })
})
