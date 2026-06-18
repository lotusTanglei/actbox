// src/lib/llm/prompts/auto-tag.ts
export type Priority = 'high' | 'normal' | 'low'
export type Importance = 'important' | 'normal'
export interface AutoTagResult {
  labels: string[]
  priority: Priority
  importance: Importance
  reason?: string
}

export function buildAutoTagPrompt(input: { subject?: string; from?: string; body: string; availableLabels?: string[] }): { system: string; temperature: number } {
  const labelsHint = input.availableLabels && input.availableLabels.length > 0
    ? `用户已有标签:[${input.availableLabels.join(', ')}]。优先从已有标签中选取,仅当都不合适时才建议一个简短新标签名。`
    : '建议 1-3 个简短中文标签名。'
  return {
    system: `你是一个邮件分类助手。根据邮件内容建议标签、优先级、重要度。${labelsHint}
严格只输出一个 JSON 对象:{"labels":["标签名"],"priority":"high|normal|low","importance":"important|normal","reason":"一句话理由"}。
priority: high=需尽快处理(截止/紧急/重要客户), normal=常规, low=通知/广播。importance: important=高价值需关注, normal=普通。不要 markdown 围栏、不要解释、不要前后缀。`,
    temperature: 0.2,
  }
}

export function parseAutoTagResult(raw: string): AutoTagResult {
  const fallback: AutoTagResult = { labels: [], priority: 'normal', importance: 'normal' }
  if (!raw) return fallback
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  const extract = (s: string): any | null => {
    try { return JSON.parse(s) } catch { /* noop */ }
    const m = s.match(/\{[\s\S]*\}/)
    if (m) { try { return JSON.parse(m[0]) } catch { /* noop */ } }
    return null
  }
  const o = extract(cleaned)
  if (!o || typeof o !== 'object') return fallback
  const pri = ['high', 'normal', 'low'].includes(o.priority) ? o.priority : 'normal'
  const imp = ['important', 'normal'].includes(o.importance) ? o.importance : 'normal'
  const labels = Array.isArray(o.labels) ? o.labels.filter((x: any) => typeof x === 'string').map((x: any) => String(x)) : []
  return { labels, priority: pri as Priority, importance: imp as Importance, reason: typeof o.reason === 'string' ? o.reason : undefined }
}
