// src/lib/llm/polish.ts
// 邮件正文润色的 prompt 构造（纯函数，便于单测）。

export type PolishAction = 'grammar' | 'formal' | 'friendly' | 'concise' | 'custom'

export const POLISH_ACTIONS: PolishAction[] = ['grammar', 'formal', 'friendly', 'concise', 'custom']

const POLISH_PROMPTS: Record<Exclude<PolishAction, 'custom'>, string> = {
  grammar: '修正拼写、标点和语法错误，保持原意与语气，不改动内容结构',
  formal: '改写得更正式、专业、得体，适合商务沟通',
  friendly: '改写得更亲切、自然、口语化，但不失礼貌',
  concise: '在不丢失关键信息的前提下尽量精简、直奔主题',
}

/** 入参字符上限（超出由调用方/路由截断） */
export const POLISH_MAX_CHARS = 20000

/** 构造润色 system prompt 与 temperature */
export function buildPolishPrompt(
  action: PolishAction,
  instruction?: string,
): { system: string; temperature: number } {
  if (action === 'custom') {
    return {
      system: `你是一个中文写作助手。按照下面这条指令改写给定的文字，保持原文语言。直接返回改写后的纯文本，不要 JSON、不要解释、不要前后缀。\n指令：${instruction || '（无）'}`,
      temperature: 0.5,
    }
  }
  return {
    system: `你是一个中文写作助手。要求：${POLISH_PROMPTS[action]}。保持原文语言（中文/英文）。直接返回改写后的纯文本，不要 JSON、不要解释、不要前后缀。`,
    temperature: action === 'grammar' ? 0.2 : 0.5,
  }
}
