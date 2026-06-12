// src/app/api/fetch/route.ts

import { NextResponse } from 'next/server'
import { MailReceiver } from '@/lib/adapter/mail'
import { extractTodos } from '@/lib/extractor'
import { getDb } from '@/lib/db'
import { todos, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST() {
  try {
    const receiver = new MailReceiver()
    const rawMessages = await receiver.fetchRecent(10)

    if (rawMessages.length === 0) {
      return NextResponse.json({
        fetched: 0,
        newTodos: 0,
        message: '没有未读邮件',
      })
    }

    const db = getDb()
    let newTodosCount = 0
    const processedMessages = []

    for (const msg of rawMessages) {
      // 幂等去重：按 messageId 检查是否已处理
      if (msg.messageId) {
        const existing = db
          .select()
          .from(messages)
          .where(eq(messages.messageId, msg.messageId))
          .all()

        if (existing.length > 0) {
          processedMessages.push({
            subject: msg.subject,
            skipped: true,
            reason: '已处理过',
          })
          continue
        }
      }

      // 跳过正文为空的邮件
      if (!msg.body || msg.body.trim().length < 10) {
        processedMessages.push({
          subject: msg.subject,
          skipped: true,
          reason: '正文为空或太短',
        })
        // 仍然记录，避免下次再拉
        db.insert(messages)
          .values({
            messageId: msg.messageId || `no-id-${Date.now()}`,
            subject: msg.subject,
            from: msg.from,
            body: msg.body,
            receivedAt: msg.receivedAt,
          })
          .run()
        continue
      }

      // 抽取待办（先抽取，再存邮件以便记录 todoCount）
      const extractResult = await extractTodos(msg.body)

      // 记录已处理邮件
      db.insert(messages)
        .values({
          messageId: msg.messageId || `no-id-${Date.now()}`,
          subject: msg.subject,
          from: msg.from,
          body: msg.body.substring(0, 500),
          bodyHtml: msg.bodyHtml || null,
          receivedAt: msg.receivedAt,
          todoCount: extractResult.todos.length,
        })
        .run()

      for (const todo of extractResult.todos) {
        db.insert(todos)
          .values({
            title: todo.title,
            dueDate: todo.dueDate || null,
            priority: todo.priority || null,
            context: todo.context || null,
            sourceMessageId: msg.messageId,
            sourceSubject: msg.subject,
            sourceFrom: msg.from,
          })
          .returning()
          .all()
        newTodosCount++
      }

      processedMessages.push({
        subject: msg.subject,
        skipped: false,
        todosExtracted: extractResult.todos.length,
      })
    }

    return NextResponse.json({
      fetched: rawMessages.length,
      newTodos: newTodosCount,
      messages: processedMessages,
    })
  } catch (error) {
    console.error('[/api/fetch] Error:', error)

    const message = error instanceof Error ? error.message : 'Internal server error'

    if (
      message.includes('IMAP') ||
      message.includes('ECONNREFUSED') ||
      message.includes('auth') ||
      message.includes('login')
    ) {
      return NextResponse.json(
        { error: `邮箱连接失败: ${message}` },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
