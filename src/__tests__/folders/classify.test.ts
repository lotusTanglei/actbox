// src/__tests__/folders/classify.test.ts

import { describe, it, expect } from 'vitest'
import { classifyFolder, type SpecUse } from '@/lib/folders/classify'

describe('classifyFolder 服务器 path → 系统 type', () => {
  it('INBOX → inbox', () => {
    expect(classifyFolder('INBOX', null)).toBe('inbox')
  })
  it('\\Sent / specialUse=sent → sent', () => {
    expect(classifyFolder('Sent', new Set(['\\Sent']) as SpecUse)).toBe('sent')
  })
  it('\\Trash 与特殊名 Trash/已删除 → trash', () => {
    expect(classifyFolder('Trash', new Set(['\\Trash']) as SpecUse)).toBe('trash')
    expect(classifyFolder('已删除', null)).toBe('trash')
  })
  it('\\Junk / Spam / 垃圾邮件 → spam', () => {
    expect(classifyFolder('Junk', new Set(['\\Junk']) as SpecUse)).toBe('spam')
    expect(classifyFolder('垃圾邮件', null)).toBe('spam')
  })
  it('\\Drafts / Draft / 草稿 → drafts', () => {
    expect(classifyFolder('Drafts', new Set(['\\Drafts']) as SpecUse)).toBe('drafts')
  })
  it('\\Archive / All Mail / 归档 → archive', () => {
    expect(classifyFolder('[Gmail]/All Mail', new Set(['\\All']) as SpecUse)).toBe('archive')
  })
  it('未知 → custom', () => {
    expect(classifyFolder('Project X', null)).toBe('custom')
  })
})
