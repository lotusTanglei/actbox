// src/__tests__/search/query-parser.test.ts

import { describe, it, expect } from 'vitest'
import { parseQuery } from '@/lib/search/query-parser'

describe('parseQuery 操作符解析', () => {
  it('纯自由文本', () => {
    expect(parseQuery('发票 报销')).toEqual({ freeText: '发票 报销' })
  })
  it('from: 单值', () => {
    expect(parseQuery('from:alice 报告')).toEqual({ freeText: '报告', from: 'alice' })
  })
  it('from: 带引号值保留空格', () => {
    expect(parseQuery('from:"Alice Lee" hello')).toEqual({ freeText: 'hello', from: 'Alice Lee' })
  })
  it('to: subject: 同时', () => {
    expect(parseQuery('to:bob subject:report')).toEqual({ freeText: '', to: 'bob', subject: 'report' })
  })
  it('has:attachment', () => {
    expect(parseQuery('预算 has:attachment')).toEqual({ freeText: '预算', hasAttachment: true })
  })
  it('after:/before: 日期解析', () => {
    expect(parseQuery('after:2024-01-01 before:2025/01/01')).toEqual({
      freeText: '',
      after: new Date('2024-01-01T00:00:00Z'),
      before: new Date('2025-01-01T00:00:00Z'),
    })
  })
  it('is:unread / is:starred', () => {
    expect(parseQuery('is:unread')).toEqual({ freeText: '', isUnread: true })
    expect(parseQuery('is:starred')).toEqual({ freeText: '', isStarred: true })
  })
  it('非法日期 → 退回 freeText', () => {
    expect(parseQuery('after:foo')).toEqual({ freeText: 'after:foo' })
  })
  it('未知 is: 值忽略', () => {
    expect(parseQuery('is:foo')).toEqual({ freeText: 'is:foo' })
  })
})
