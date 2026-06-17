// src/__tests__/adapter/presets.test.ts

import { describe, it, expect } from 'vitest'
import { getPreset, PRESETS } from '@/lib/adapter/mail/presets'

describe('provider presets', () => {
  it('163 预设正确', () => {
    expect(getPreset('163')).toEqual(
      expect.objectContaining({
        imapHost: 'imap.163.com',
        imapPort: 993,
        smtpHost: 'smtp.163.com',
        smtpPort: 465,
      }),
    )
  })

  it('gmail 标记 oauth', () => {
    expect(getPreset('gmail')?.oauth).toBe(true)
  })

  it('custom 无预设返回 null', () => {
    expect(getPreset('custom')).toBeNull()
  })

  it('PRESETS 覆盖主流服务商', () => {
    expect(PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['163', '126', 'qq', 'gmail', 'outlook']),
    )
  })
})
