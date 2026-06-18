// src/app/api/folders/[id]/route.ts — 自定义文件夹本地改名(MailAdapter 暂无 create/rename,仅本地)

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/folders/[id] — body {displayName} 本地重命名自定义文件夹 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const folderId = parseInt(id, 10)
    if (isNaN(folderId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const body = await request.json()
    if (!body?.displayName) return NextResponse.json({ error: '缺少 displayName' }, { status: 400 })

    const raw = getRawDb()
    const result = raw
      .prepare('UPDATE folders SET display_name = ? WHERE id = ?')
      .run(String(body.displayName), folderId)
    if (result.changes === 0) return NextResponse.json({ error: '文件夹不存在' }, { status: 404 })

    const row = raw.prepare('SELECT * FROM folders WHERE id = ?').get(folderId)
    return NextResponse.json({ folder: row })
  } catch (error) {
    console.error('[/api/folders/[id] PATCH] Error:', error)
    return NextResponse.json({ error: '重命名失败' }, { status: 500 })
  }
}
