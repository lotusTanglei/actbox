// src/__tests__/security/spam.test.ts
import { describe, it, expect } from 'vitest'
import { scoreSpam, type SpamContext } from '@/lib/security/spam'

const ctx = (over: Partial<SpamContext> = {}): SpamContext => ({
  from: 'friend@example.com', subject: 'Hello', bodyText: 'How are you?', bodyHtml: '<p>How are you?</p>',
  date: new Date('2026-06-01').toISOString(), messageId: '<abc@example.com>', hasAttachment: false,
  receivedHeader: 'from mail.example.com (mail.example.com [1.2.3.4])', ...over,
})

describe('scoreSpam', () => {
  it('正常邮件低分不判垃圾', () => { const v = scoreSpam(ctx()); expect(v.isSpam).toBe(false); expect(v.score).toBeLessThan(5) })
  it('SUBJ_ALL_CAPS + FREE_WORD 命中', () => { const v = scoreSpam(ctx({ subject: 'FREE VIAGRA NOW', bodyText: 'click here now free prize lottery', receivedHeader: 'from [1.2.3.4]' })); expect(v.isSpam).toBe(true); expect(v.reasons).toContain('FREE_WORD'); expect(v.reasons).toContain('SUBJ_ALL_CAPS') })
  it('中文免费词命中', () => { const v = scoreSpam(ctx({ subject: '恭喜中奖通知', bodyText: '免费领取' })); expect(v.reasons).toContain('FREE_WORD') })
  it('URGENCY_WORDS 命中', () => { expect(scoreSpam(ctx({ bodyText: '请立即点击确认 act now' })).reasons).toContain('URGENCY_WORDS') })
  it('RDNS_NONE', () => { expect(scoreSpam(ctx({ receivedHeader: 'from [1.2.3.4]' })).reasons).toContain('RDNS_NONE') })
  it('FROM_LOCALPART_NUMERIC', () => { expect(scoreSpam(ctx({ from: '12345678@suspicious.tk' })).reasons).toContain('FROM_LOCALPART_NUMERIC') })
  it('MISSING_DATE/MESSAGE_ID', () => { const v = scoreSpam(ctx({ date: null as any, messageId: null as any })); expect(v.reasons).toContain('MISSING_DATE'); expect(v.reasons).toContain('MISSING_MESSAGE_ID') })
  it('HTML_FORM', () => { expect(scoreSpam(ctx({ bodyHtml: '<form action="http://x">密码</form>' })).reasons).toContain('HTML_FORM') })
  it('阈值可配', () => { const v = scoreSpam(ctx({ subject: 'FREE' }), { threshold: 10 }); expect(v.isSpam).toBe(false) })
  it('返回完整结构', () => { const v = scoreSpam(ctx()); expect(v).toHaveProperty('score'); expect(v).toHaveProperty('isSpam'); expect(Array.isArray(v.reasons)).toBe(true) })
  it('白名单豁免', () => { const v = scoreSpam(ctx({ subject: 'FREE VIAGRA NOW', from: 'vip@x.com' }), { whitelistSenders: ['vip@x.com'] }); expect(v.isSpam).toBe(false) })
})
