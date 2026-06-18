// src/app/api/labels/route.ts
// 标签 CRUD：GET 列表、POST 创建。plan-08 Task 9。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { createLabel, listLabels } from '@/lib/labels/repo'

/** GET /api/labels?accountId=1 — 列出某账号所有标签 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const accountId = Number(searchParams.get('accountId') || 1)
    const db = getRawDb()
    const labels = listLabels(db, accountId)
    return NextResponse.json({ labels })
  } catch (error) {
    console.error('[/api/labels GET] Error:', error)
    return NextResponse.json({ error: 'Failed to list labels' }, { status: 500 })
  }
}

/** POST /api/labels — 创建标签（同名幂等返回既有） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountId, name, color, parentId } = body
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'name 必填' }, { status: 400 })
    }

    const db = getRawDb()
    const existing = db
      .prepare('SELECT id FROM labels WHERE account_id = ? AND name = ?')
      .get(accountId || 1, name.trim()) as { id: number } | undefined

    const label = createLabel(db, {
      accountId: accountId || 1,
      name: name.trim(),
      color: color || undefined,
      parentId: parentId || null,
    })

    const status = existing ? 200 : 201
    return NextResponse.json({ label }, { status })
  } catch (error) {
    console.error('[/api/labels POST] Error:', error)
    return NextResponse.json({ error: 'Failed to create label' }, { status: 500 })
  }
}
