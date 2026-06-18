// src/app/api/messages/[id]/todo/route.ts
// 邮件一键转待办：复用 todos 表 + sourceMessageId 关联。plan-08 Task 10。

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'

/** POST /api/messages/[id]/todo — 从邮件创建待办 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const db = getRawDb()

    // 1. 查邮件行
    const msg = db
      .prepare(
        'SELECT id, message_id, subject, sender, account_id FROM messages WHERE id = ?',
      )
      .get(parseInt(id, 10)) as
      | { id: number; message_id: string; subject: string | null; sender: string | null; account_id: number | null }
      | undefined

    if (!msg) {
      return NextResponse.json({ error: '邮件不存在' }, { status: 404 })
    }

    // 2. title 回退用 subject
    const title = (body.title || msg.subject || '未命名待办').trim()
    const priority = body.priority || null
    const dueDate = body.dueDate || null
    const context = body.context || null

    // 3. 事务内创建 todo + 回写 todo_count
    const todoId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO todos (title, due_date, priority, context, source_message_id, source_subject, source_from, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          title,
          dueDate,
          priority,
          context,
          msg.message_id,
          msg.subject,
          msg.sender,
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
        )

      // 回写 todo_count
      db.prepare('UPDATE messages SET todo_count = todo_count + 1 WHERE id = ?').run(msg.id)

      return Number(info.lastInsertRowid)
    })()

    const created = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId) as any

    return NextResponse.json(
      {
        todo: {
          id: created.id,
          title: created.title,
          dueDate: created.due_date,
          priority: created.priority,
          context: created.context,
          status: created.status,
          sourceMessageId: created.source_message_id,
          sourceSubject: created.source_subject,
          sourceFrom: created.source_from,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[/api/messages/[id]/todo] Error:', error)
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 })
  }
}
