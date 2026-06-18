// src/app/api/search/saved/[id]/route.ts
// DELETE /api/search/saved/[id] — 删除指定 Saved Search。plan-07 Task 7。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { getSettingJSON, setSettingJSON } from '@/lib/db/settings'
import type { SavedSearch } from '../route'

const KEY = 'saved_searches'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const db = getRawDb()
    const list = getSettingJSON<SavedSearch[]>(db, KEY, [])
    const next = list.filter((s) => s.id !== id)
    setSettingJSON(db, KEY, next)
    return NextResponse.json({ ok: true, removed: list.length - next.length })
  } catch (error) {
    console.error('[/api/search/saved/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
