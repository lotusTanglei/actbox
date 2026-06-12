// src/lib/extractor/index.ts

import { getLlmClient, getModelName } from '@/lib/llm/client'
import { getSystemPrompt } from './prompt'
import type { ExtractResult, ExtractedTodo, LlmExtractionResponse } from './types'

/**
 * 从邮件正文中抽取待办事项
 * @param emailBody 邮件清洗后的纯文本正文
 * @returns 抽取结果
 */
export async function extractTodos(emailBody: string): Promise<ExtractResult> {
  const client = getLlmClient()
  const model = getModelName()

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: emailBody },
    ],
    temperature: 0.1, // 低温度，稳定输出
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('LLM returned empty response')
  }

  // 解析 JSON（容错处理）
  let parsed: LlmExtractionResponse
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\nRaw: ${content}`)
  }

  // 只保留可行动的待办
  const todos: ExtractedTodo[] = (parsed.todos || [])
    .filter((t) => t.isActionable !== false)
    .map((t) => ({
      title: t.title,
      dueDate: t.dueDate || undefined,
      priority: t.priority || undefined,
      context: t.context || undefined,
    }))

  return {
    todos,
    rawInput: emailBody,
  }
}
