import { describe, it, expect } from 'vitest'
import { buildSuggestReplyPrompt, parseSuggestReplyResult } from '@/lib/llm/prompts/suggest-reply'

describe('buildSuggestReplyPrompt', () => {
  it('system 指示输出 JSON 数组 + 条数', () => {
    const { system } = buildSuggestReplyPrompt({ subject: 'S', body: 'b', count: 3 })
    expect(system).toMatch(/JSON/)
    expect(system).toMatch(/3.*条|2.*3|两条|三条/)
  })
  it('每条简短(≤50 字)', () => {
    const { system } = buildSuggestReplyPrompt({ subject: 'S', body: 'b' })
    expect(system).toMatch(/50|简短/)
  })
  it('中文回复指示', () => {
    expect(buildSuggestReplyPrompt({ body: 'b' }).system).toMatch(/中文/)
  })
})

describe('parseSuggestReplyResult', () => {
  it('解析合法 JSON 数组', () => {
    const r = parseSuggestReplyResult('[{"text":"好的","tone":"同意"}]')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('好的')
  })
  it('剥 ```json 围栏', () => {
    const r = parseSuggestReplyResult('```json\n[{"text":"ok","tone":"同意"}]\n```')
    expect(r).toHaveLength(1)
  })
  it('从混合文本提取第一个数组', () => {
    const r = parseSuggestReplyResult('以下是建议:\n[{"text":"hi","tone":"致谢"}]\n谢谢')
    expect(r).toHaveLength(1)
  })
  it('非法输入 → 空数组(不抛)', () => {
    expect(parseSuggestReplyResult('not json')).toEqual([])
    expect(parseSuggestReplyResult('')).toEqual([])
  })
})
