// src/app/api/todos/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { todos } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'

/** GET /api/todos — 列表，支持筛选 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // pending | done | all (default: all)

    const conditions = []
    if (status && status !== 'all') {
      conditions.push(eq(todos.status, status))
    }

    const result =
      conditions.length > 0
        ? db.select().from(todos).where(and(...conditions)).orderBy(desc(todos.createdAt)).all()
        : db.select().from(todos).orderBy(desc(todos.createdAt)).all()

    return NextResponse.json({ todos: result })
  } catch (error) {
    console.error('[/api/todos GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch todos' }, { status: 500 })
  }
}

/** POST /api/todos — 手动创建待办 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb()
    const body = await request.json()
    const { title, dueDate, priority, context } = body

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid title' }, { status: 400 })
    }

    const result = db
      .insert(todos)
      .values({
        title,
        dueDate: dueDate || null,
        priority: priority || null,
        context: context || null,
      })
      .returning()

    return NextResponse.json({ todo: result[0] }, { status: 201 })
  } catch (error) {
    console.error('[/api/todos POST] Error:', error)
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 })
  }
}
