// src/app/api/todos/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { todos } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/todos/[id] — 更新（主要用 toggle status） */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const db = getDb()
    const { id } = await context.params
    const body = await request.json()
    const todoId = parseInt(id, 10)

    if (isNaN(todoId)) {
      return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (body.status !== undefined) updates.status = body.status
    if (body.title !== undefined) updates.title = body.title
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate
    if (body.priority !== undefined) updates.priority = body.priority

    const result = db
      .update(todos)
      .set(updates)
      .where(eq(todos.id, todoId))
      .returning()
      .all()

    if (!result.length) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
    }

    return NextResponse.json({ todo: result[0] })
  } catch (error) {
    console.error('[/api/todos/[id] PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 })
  }
}

/** DELETE /api/todos/[id] */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const db = getDb()
    const { id } = await context.params
    const todoId = parseInt(id, 10)

    if (isNaN(todoId)) {
      return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 })
    }

    const result = db.delete(todos).where(eq(todos.id, todoId)).returning().all()

    if (!result.length) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/todos/[id] DELETE] Error:', error)
    return NextResponse.json({ error: 'Failed to delete todo' }, { status: 500 })
  }
}
