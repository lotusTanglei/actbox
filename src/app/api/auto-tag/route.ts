// src/app/api/auto-tag/route.ts
import { NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import { buildAutoTagPrompt, parseAutoTagResult } from '@/lib/llm/prompts/auto-tag'

export async function POST(req: Request) {
  const body = await req.json()
  let subject = body.subject, from = body.from, text = body.body as string | undefined

  if (body.messageId) {
    const m = getRawDb().prepare('SELECT sender, subject, body FROM messages WHERE id = ?').get(Number(body.messageId)) as any
    if (!m) return NextResponse.json({ error: 'message not found' }, { status: 404 })
    subject = m.subject; from = m.sender; text = m.body
  }
  if (!text) return NextResponse.json({ error: 'Missing messageId or body' }, { status: 400 })

  // 查既有标签供 prompt
  let availableLabels: string[] = []
  try {
    const labels = getRawDb().prepare('SELECT name FROM labels').all() as any[]
    availableLabels = labels.map((l: any) => l.name)
  } catch { /* labels 表可能不存在 */ }

  const { system, temperature } = buildAutoTagPrompt({ subject, from, body: text, availableLabels })
  const client = getLlmClient('classify')
  const model = getModelName('classify')
  const resp = await client.chat.completions.create({
    model, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `发件人:${from || '(无)'}\n主题:${subject || '(无主题)'}\n正文:\n${text}` }],
  })
  const content = resp.choices[0]?.message?.content || ''
  const result = parseAutoTagResult(content)
  return NextResponse.json(result)
}
