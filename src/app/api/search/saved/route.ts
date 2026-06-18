// src/app/api/search/saved/route.ts
// Saved Search:GET 列表 / POST 新建。存 settings KV saved_searches。plan-07 Task 7。

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getRawDb } from '@/lib/db'
import { getSettingJSON, setSettingJSON } from '@/lib/db/settings'

export interface SavedSearch {
  id: string
  name: string
  query: string
  createdAt: number
}

const KEY = 'saved_searches'

/** GET /api/search/saved — 列出 Saved Search */
export async function GET(_request: NextRequest) {
  const list = getSettingJSON<SavedSearch[]>(getRawDb(), KEY, [])
  return NextResponse.json({ searches: list })
}

/** POST /api/search/saved — 新建 {name, query} */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = String(body?.name ?? '').trim()
    const query = String(body?.query ?? '').trim()
    if (!name || !query) {
      return NextResponse.json({ error: '需要 name 和 query' }, { status: 400 })
    }
    const db = getRawDb()
    const list = getSettingJSON<SavedSearch[]>(db, KEY, [])
    const entry: SavedSearch = { id: randomUUID(), name, query, createdAt: Date.now() }
    list.push(entry)
    setSettingJSON(db, KEY, list)
    return NextResponse.json({ search: entry })
  } catch (error) {
    console.error('[/api/search/saved POST] Error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
