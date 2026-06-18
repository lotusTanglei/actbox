// src/app/api/labels/[id]/route.ts
// 标签 PATCH 更新 / DELETE 删除（级联 message_labels）。plan-08 Task 9。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { updateLabel, deleteLabel } from '@/lib/labels/repo'

/** PATCH /api/labels/[id] — 改名/改色/改父 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const db = getRawDb()

    const label = updateLabel(db, parseInt(id, 10), {
      name: body.name,
      color: body.color,
      parentId: body.parentId,
    })

    if (!label) {
      return NextResponse.json({ error: '标签不存在' }, { status: 404 })
    }

    return NextResponse.json({ label })
  } catch (error) {
    console.error('[/api/labels/[id] PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update label' }, { status: 500 })
  }
}

/** DELETE /api/labels/[id] — 删除标签（级联删除 message_labels 关联） */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const db = getRawDb()
    const changed = deleteLabel(db, parseInt(id, 10))

    if (changed === 0) {
      return NextResponse.json({ error: '标签不存在' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/labels/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete label' }, { status: 500 })
  }
}
