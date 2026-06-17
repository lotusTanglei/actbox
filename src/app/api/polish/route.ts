// src/app/api/polish/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import {
  buildPolishPrompt,
  POLISH_ACTIONS,
  POLISH_MAX_CHARS,
  type PolishAction,
} from '@/lib/llm/polish'

/** POST /api/polish — AI 润色（选区优先，否则整篇；纯文本往返） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, action, instruction } = body as {
      text?: string
      action?: PolishAction
      instruction?: string
    }

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    }
    if (!action || !POLISH_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const truncated = text.length > POLISH_MAX_CHARS
    const input = truncated ? text.slice(0, POLISH_MAX_CHARS) : text

    const { system, temperature } = buildPolishPrompt(action, instruction)
    const client = getLlmClient()
    const model = getModelName()

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input },
      ],
      temperature,
    })

    const polished = response.choices[0]?.message?.content || ''
    return NextResponse.json({ polished, truncated })
  } catch (error) {
    console.error('[/api/polish] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
