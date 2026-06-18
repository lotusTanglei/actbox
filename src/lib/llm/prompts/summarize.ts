// src/lib/llm/prompts/summarize.ts
export type SummarizeStyle = 'brief' | 'bullet' | 'normal'
export const SUMMARIZE_MAX_CHARS = 12000

const STYLE_INSTRUCTION: Record<SummarizeStyle, string> = {
  brief: '用一句话概括邮件核心(不超过 40 字)',
  bullet: '用 3 到 5 个要点概括,每点一行,以「•」开头',
  normal: '用 2 到 3 句话概括邮件主要内容与需采取的行动',
}

export interface SummarizeInput {
  subject?: string
  from?: string
  body: string
  style?: SummarizeStyle
}

export function buildSummarizePrompt(input: SummarizeInput): { system: string; temperature: number } {
  const style = input.style || 'normal'
  return {
    system: `你是一个邮件摘要助手。要求:${STYLE_INSTRUCTION[style]}。用中文输出。如实概括邮件已有内容,不要编造、不要补充邮件未提及的信息。聚焦可行动信息(谁需要在何时做什么)。直接返回摘要纯文本,不要 JSON、不要解释、不要前后缀。`,
    temperature: 0.2,
  }
}
