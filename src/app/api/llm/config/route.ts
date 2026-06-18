// src/app/api/llm/config/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getLlmConfig, saveLlmConfig, listProviders } from '@/lib/llm/config'
import { __resetLlmClientCache } from '@/lib/llm/client'

function mask(key: string): { masked: string; set: boolean } {
  if (!key) return { masked: '', set: false }
  if (key.length <= 8) return { masked: '*'.repeat(key.length), set: true }
  return { masked: `${key.slice(0, 4)}***${key.slice(-3)}`, set: true }
}

export async function GET() {
  const cfg = getLlmConfig(getDb())
  const { masked, set } = mask(cfg.apiKey)
  return NextResponse.json({
    config: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      capabilities: cfg.capabilities,
      apiKeyMasked: masked,
      apiKeySet: set,
    },
    providers: listProviders(),
  })
}

export async function PATCH(req: Request) {
  const body = await req.json()
  saveLlmConfig(getDb(), body)
  __resetLlmClientCache()
  return NextResponse.json({ ok: true })
}
