// src/app/api/llm/test/route.ts
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getDb } from '@/lib/db'
import { getLlmConfig } from '@/lib/llm/config'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  // 优先用请求体里的临时配置(用户还没保存想先测),否则读已存
  const stored = getLlmConfig(getDb())
  const provider = body.provider || stored.provider
  const apiKey = body.apiKey !== undefined ? body.apiKey : stored.apiKey
  const baseUrl = body.baseUrl || stored.baseUrl
  const model = body.model || stored.model

  if (!apiKey) return NextResponse.json({ ok: false, error: '未配置 API key,请先填写 LLM API Key' })

  const client = new OpenAI({ apiKey, baseURL: baseUrl })
  const t0 = Date.now()
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    })
    return NextResponse.json({ ok: true, latencyMs: Date.now() - t0, model, provider })
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status
    const msg = status === 401 ? `API key 认证失败(401):${e.message || ''}` : status === 404 ? `模型/端点不存在(404):${e.message || ''}` : `连接失败:${e.message || String(e)}`
    return NextResponse.json({ ok: false, error: msg, latencyMs: Date.now() - t0, provider, model })
  }
}
