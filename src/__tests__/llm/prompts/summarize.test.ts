import { describe, it, expect } from 'vitest'
import { buildSummarizePrompt, SUMMARIZE_MAX_CHARS } from '@/lib/llm/prompts/summarize'

describe('buildSummarizePrompt', () => {
  it('normal 风格:system 含 2-3 句 + 中文指示', () => {
    const { system, temperature } = buildSummarizePrompt({ subject: 'S', from: 'a@b', body: '正文', style: 'normal' })
    expect(system).toMatch(/2.*3|两到三/i)
    expect(system).toMatch(/中文/)
    expect(temperature).toBeGreaterThan(0)
  })
  it('brief 风格:一句话', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'brief' })
    expect(system).toMatch(/一句话|一句/)
  })
  it('bullet 风格:3-5 要点', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'bullet' })
    expect(system).toMatch(/3.*5|三到五|要点/)
  })
  it('指示不编造 + 可行动信息', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b', style: 'normal' })
    expect(system).toMatch(/不要编造|如实/)
  })
  it('默认 normal', () => {
    const { system } = buildSummarizePrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/中文/)
  })
  it('SUMMARIZE_MAX_CHARS 上限存在', () => {
    expect(SUMMARIZE_MAX_CHARS).toBeGreaterThan(1000)
  })
})
