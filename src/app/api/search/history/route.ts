// src/app/api/search/history/route.ts
// 搜索历史:GET 列表 / POST 记录(query 去重) / DELETE 清空。plan-07 Task 7。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { listSearchHistory, recordSearchHistory, clearSearchHistory } from '@/lib/search/history'

/** GET /api/search/history — 列出历史(最近 50) */
export async function GET(_request: NextRequest) {
  return NextResponse.json({ history: listSearchHistory(getRawDb()) })
}

/** POST /api/search/history — 记录 {query}(去重仅留最新) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const q = recordSearchHistory(getRawDb(), String(body?.query ?? ''))
    if (!q) return NextResponse.json({ error: '空 query' }, { status: 400 })
    return NextResponse.json({ ok: true, query: q })
  } catch (error) {
    console.error('[/api/search/history POST] Error:', error)
    return NextResponse.json({ error: 'Failed to record' }, { status: 500 })
  }
}

/** DELETE /api/search/history — 清空历史 */
export async function DELETE(_request: NextRequest) {
  clearSearchHistory(getRawDb())
  return NextResponse.json({ ok: true })
}
