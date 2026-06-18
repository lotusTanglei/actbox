// src/__tests__/contacts/parse-emails.test.ts
import { describe, it, expect } from 'vitest'
import { parseAddresses } from '@/lib/contacts/parse-emails'

describe('parseAddresses', () => {
  it('解析 "Name <a@b>" 单个', () => {
    expect(parseAddresses('张三 <zhangsan@x.com>')).toEqual([{ name: '张三', email: 'zhangsan@x.com' }])
  })
  it('解析逗号分隔多个（含混合）', () => {
    expect(parseAddresses('张三 <a@x>, b@y.com, 李四 <c@z>')).toEqual([
      { name: '张三', email: 'a@x' },
      { name: '', email: 'b@y.com' },
      { name: '李四', email: 'c@z' },
    ])
  })
  it('纯邮箱无尖括号', () => {
    expect(parseAddresses('only@x.com')).toEqual([{ name: '', email: 'only@x.com' }])
  })
  it('空/null → []', () => {
    expect(parseAddresses(null as any)).toEqual([])
    expect(parseAddresses('   ')).toEqual([])
  })
  it('email 小写化去空白', () => {
    expect(parseAddresses(' <A@X.com >')).toEqual([{ name: '', email: 'a@x.com' }])
  })
})
