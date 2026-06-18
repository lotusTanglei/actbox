import { describe, it, expect } from 'vitest'
import { buildAutoTagPrompt, parseAutoTagResult } from '@/lib/llm/prompts/auto-tag'

describe('buildAutoTagPrompt', () => {
  it('指示输出 JSON 含 labels/priority/importance', () => {
    const { system } = buildAutoTagPrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/labels/)
    expect(system).toMatch(/priority/)
    expect(system).toMatch(/importance/)
  })
  it('优先复用既有标签', () => {
    const { system } = buildAutoTagPrompt({ subject: 'S', body: 'b', availableLabels: ['工作', '账单'] })
    expect(system).toMatch(/工作|账单/)
    expect(system).toMatch(/优先|复用|已有/)
  })
  it('priority 取值约束', () => {
    expect(buildAutoTagPrompt({ body: 'b' }).system).toMatch(/high|normal|low/)
  })
})

describe('parseAutoTagResult', () => {
  it('解析合法对象', () => {
    const r = parseAutoTagResult('{"labels":["工作"],"priority":"high","importance":"important","reason":"紧急"}')
    expect(r.labels).toEqual(['工作'])
    expect(r.priority).toBe('high')
    expect(r.importance).toBe('important')
  })
  it('剥围栏', () => {
    const r = parseAutoTagResult('```json\n{"labels":[],"priority":"normal","importance":"normal"}\n```')
    expect(r.priority).toBe('normal')
  })
  it('字段缺失 → 默认', () => {
    const r = parseAutoTagResult('{}')
    expect(r.labels).toEqual([])
    expect(r.priority).toBe('normal')
    expect(r.importance).toBe('normal')
  })
  it('非法 → 默认对象(不抛)', () => {
    const r = parseAutoTagResult('xx')
    expect(r.labels).toEqual([])
  })
})
