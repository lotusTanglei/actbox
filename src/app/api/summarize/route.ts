// src/app/api/summarize/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmClient, getModelName } from '@/lib/llm/client'
import { buildSummarizePrompt, SUMMARIZE_MAX_CHARS } from '@/lib/llm/prompts/summarize'

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

  const truncated = text.slice(0, SUMMARIZE_MAX_CHARS)
  const { system, temperature } = buildSummarizePrompt({ subject, from, body: truncated, style: body.style })
  const client = getLlmClient('summarize')
  const model = getModelName('summarize')
  const resp = await client.chat.completions.create({
    model, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `发件人:${from || '(无)'}\n主题:${subject || '(无主题)'}\n正文:\n${truncated}` }],
  })
  const summary = resp.choices[0]?.message?.content || ''
  return NextResponse.json({ summary })
}
