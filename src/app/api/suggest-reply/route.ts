// src/app/api/suggest-reply/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import { buildSuggestReplyPrompt, parseSuggestReplyResult } from '@/lib/llm/prompts/suggest-reply'

export async function POST(req: Request) {
  const body = await req.json()
  const db = getDb()
  let subject = body.subject, from = body.from, text = body.body as string | undefined

  if (body.messageId) {
    const m = db.prepare('SELECT sender, subject, body FROM messages WHERE id = ?').get(Number(body.messageId)) as any
    if (!m) return NextResponse.json({ error: 'message not found' }, { status: 404 })
    subject = m.subject; from = m.sender; text = m.body
  }
  if (!text) return NextResponse.json({ error: 'Missing messageId or body' }, { status: 400 })

  const { system, temperature } = buildSuggestReplyPrompt({ subject, from, body: text, count: body.count })
  const client = getLlmClient('reply')
  const model = getModelName('reply')
  const resp = await client.chat.completions.create({
    model, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `发件人:${from || '(无)'}\n主题:${subject || '(无主题)'}\n正文:\n${text}` }],
  })
  const content = resp.choices[0]?.message?.content || ''
  const suggestions = parseSuggestReplyResult(content)
  return NextResponse.json({ suggestions })
}
