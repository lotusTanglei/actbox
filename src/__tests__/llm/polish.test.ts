// src/__tests__/llm/polish.test.ts

import { describe, it, expect } from 'vitest'
import { buildPolishPrompt, PolishAction } from '@/lib/llm/polish'

const ALL: PolishAction[] = ['grammar', 'formal', 'friendly', 'concise', 'custom']

describe('buildPolishPrompt', () => {
  it('grammar 动作：含修正要求、低温 0.2', () => {
    const { system, temperature } = buildPolishPrompt('grammar')
    expect(system).toContain('修正')
    expect(temperature).toBe(0.2)
  })

  it('formal 动作：含正式、温度 0.5', () => {
    const { system, temperature } = buildPolishPrompt('formal')
    expect(system).toContain('正式')
    expect(temperature).toBe(0.5)
  })

  it('friendly / concise 动作关键词', () => {
    expect(buildPolishPrompt('friendly').system).toContain('亲切')
    expect(buildPolishPrompt('concise').system).toContain('精简')
  })

  it('custom 动作：拼入用户指令', () => {
    const { system, temperature } = buildPolishPrompt('custom', '缩短一半并更礼貌')
    expect(system).toContain('缩短一半并更礼貌')
    expect(temperature).toBe(0.5)
  })

  it('custom 动作无指令时标注（无）', () => {
    expect(buildPolishPrompt('custom').system).toContain('（无）')
  })

  it('所有动作都要求纯文本输出、禁 JSON', () => {
    for (const action of ALL) {
      const { system } = buildPolishPrompt(action, action === 'custom' ? 'x' : undefined)
      expect(system).toContain('纯文本')
      expect(system).toContain('JSON')
    }
  })
})
