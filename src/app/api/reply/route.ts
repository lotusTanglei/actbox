// src/app/api/reply/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import { getLlmConfig } from '@/lib/llm/config'

const REPLY_SYSTEM_PROMPT = `你是一个专业的邮件回复助手。根据原始邮件内容，起草一封合适的回复。

## 规则

1. 用中文回复（除非原邮件是英文）
2. 语气专业得体，匹配原邮件的正式程度
3. 回复简洁，直奔主题
4. 如果原邮件包含待办事项，确认已了解并表示会处理
5. 不要过度承诺具体时间（除非用户指定）
6. 签名用 "祝好" 或 "此致敬礼" 即可

## 输出

直接返回回复正文纯文本，不要 JSON，不要多余格式。`

/** POST /api/reply — AI 起草回复 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { originalBody, originalSubject, todoContext } = body

    if (!originalBody) {
      return NextResponse.json({ error: 'Missing originalBody' }, { status: 400 })
    }

    const client = getLlmClient()
    const model = getModelName()
    const cfg = getLlmConfig(getDb())

    let userPrompt = `原始邮件主题：${originalSubject || '(无主题)'}\n\n原始邮件内容：\n${originalBody}`
    if (todoContext) {
      userPrompt += `\n\n相关待办：${todoContext}`
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: REPLY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: cfg.temperature,
    })

    const draft = response.choices[0]?.message?.content || ''

    return NextResponse.json({ draft })
  } catch (error) {
    console.error('[/api/reply] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
