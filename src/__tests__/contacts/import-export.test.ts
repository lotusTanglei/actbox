// src/__tests__/contacts/import-export.test.ts
import { describe, it, expect } from 'vitest'
import { parseVCard, toVCard, parseCsv, toCsv } from '@/lib/contacts/import-export'

describe('parseVCard', () => {
  it('解析单条', () => {
    const vcf = ['BEGIN:VCARD','VERSION:3.0','FN:张三','EMAIL:z@x.com','TEL;TYPE=CELL:13800','NOTE:hi','END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toEqual([{ name: '张三', email: 'z@x.com', phone: '13800', note: 'hi' }])
  })
  it('解析多条', () => {
    const vcf = ['BEGIN:VCARD','VERSION:3.0','FN:A','EMAIL:a@x.com','END:VCARD','BEGIN:VCARD','VERSION:3.0','FN:B','EMAIL:b@x.com','END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toHaveLength(2)
  })
  it('缺 email 的条目丢弃', () => {
    expect(parseVCard('BEGIN:VCARD\nVERSION:3.0\nFN:NoEmail\nEND:VCARD')).toEqual([])
  })
  it('CRLF 换行兼容', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nEMAIL:a@x.com\r\nEND:VCARD\r\n'
    expect(parseVCard(vcf)[0].email).toBe('a@x.com')
  })
})
describe('toVCard', () => {
  it('序列化含 FN/EMAIL/TEL/NOTE', () => {
    const out = toVCard([{ name: '张三', email: 'z@x.com', phone: '13800', note: 'n' }])
    expect(out).toContain('BEGIN:VCARD')
    expect(out).toContain('FN:张三')
    expect(out).toContain('EMAIL:z@x.com')
    expect(out).toContain('TEL;TYPE=CELL:13800')
    expect(out).toContain('END:VCARD')
  })
})
describe('parseCsv / toCsv', () => {
  it('往返', () => {
    const rows = [{ name: 'A', email: 'a@x.com', phone: '1', note: 'n' }, { name: 'B', email: 'b@x.com', phone: '', note: '' }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
  it('CSV 含逗号/引号正确转义', () => {
    const rows = [{ name: 'A, B', email: 'a@x.com', phone: '', note: 'he said "hi"' }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
