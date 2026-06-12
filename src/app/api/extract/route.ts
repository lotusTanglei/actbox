// src/app/api/extract/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { extractTodos } from '@/lib/extractor'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { emailBody } = body

    if (!emailBody || typeof emailBody !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid emailBody field' },
        { status: 400 }
      )
    }

    if (emailBody.length > 50_000) {
      return NextResponse.json(
        { error: 'Email body too long (max 50,000 characters)' },
        { status: 400 }
      )
    }

    const result = await extractTodos(emailBody)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/extract] Error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'

    // 区分配置错误和服务错误
    if (message.includes('API key') || message.includes('provider')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
