// src/lib/llm/prompts/suggest-reply.ts
export interface ReplySuggestion {
  text: string
  tone: '同意' | '委婉拒绝' | '询问详情' | '致谢' | '其他'
}

export function buildSuggestReplyPrompt(input: { subject?: string; from?: string; body: string; count?: number }): { system: string; temperature: number } {
  const count = input.count && input.count >= 2 && input.count <= 3 ? input.count : 3
  return {
    system: `你是一个邮件快速回复助手。根据原邮件生成 ${count} 条简短回复选项(每条不超过 50 字),覆盖不同立场(如同意/委婉拒绝/询问详情/致谢)。用中文。
严格只输出一个 JSON 数组,格式:[{"text":"回复正文","tone":"同意|委婉拒绝|询问详情|致谢|其他"}]。不要 markdown 围栏、不要解释、不要前后缀。`,
    temperature: 0.6,
  }
}

export function parseSuggestReplyResult(raw: string): ReplySuggestion[] {
  if (!raw) return []
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const tryParse = (s: string): ReplySuggestion[] | null => {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return arr.filter((x) => x && typeof x.text === 'string').map((x) => ({ text: String(x.text), tone: x.tone || '其他' }))
    } catch { /* noop */ }
    return null
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  // 从混合文本抽第一个 [...] 段
  const m = cleaned.match(/\[[\s\S]*\]/)
  return m ? (tryParse(m[0]) || []) : []
}
