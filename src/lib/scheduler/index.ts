// src/lib/scheduler/index.ts

import cron from 'node-cron'

let scheduledTask: ReturnType<typeof cron.schedule> | null = null

/**
 * 启动定时拉取
 * @param cronExpression cron 表达式，默认每 30 分钟
 * @param onFetch 回调函数（拉取后通知前端等）
 */
export function startScheduler(
  cronExpression = '*/30 * * * *',
  onFetch?: (result: { fetched: number; newTodos: number }) => void
) {
  // 如果已有任务，先停止
  stopScheduler()

  scheduledTask = cron.schedule(cronExpression, async () => {
    try {
      console.log('[Scheduler] 开始定时拉取...')
      const { MailReceiver } = await import('@/lib/adapter/mail')
      const { extractTodos } = await import('@/lib/extractor')
      const { getDb } = await import('@/lib/db')
      const { todos, messages } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')

      const receiver = new MailReceiver()
      const rawMessages = await receiver.fetchRecent(10)

      if (rawMessages.length === 0) {
        console.log('[Scheduler] 没有未读邮件')
        return
      }

      const db = getDb()
      let newTodosCount = 0

      for (const msg of rawMessages) {
        if (msg.messageId) {
          const existing = db.select().from(messages).where(eq(messages.messageId, msg.messageId)).all()
          if (existing.length > 0) continue
        }

        if (!msg.body || msg.body.trim().length < 10) {
          db.insert(messages).values({
            messageId: msg.messageId || `no-id-${Date.now()}`,
            subject: msg.subject,
            from: msg.from,
            body: msg.body,
            receivedAt: msg.receivedAt,
          }).run()
          continue
        }

        const extractResult = await extractTodos(msg.body)

        db.insert(messages).values({
          messageId: msg.messageId || `no-id-${Date.now()}`,
          subject: msg.subject,
          from: msg.from,
          body: msg.body,
          bodyHtml: msg.bodyHtml || null,
          receivedAt: msg.receivedAt,
          todoCount: extractResult.todos.length,
        }).run()

        for (const todo of extractResult.todos) {
          db.insert(todos).values({
            title: todo.title,
            dueDate: todo.dueDate || null,
            priority: todo.priority || null,
            context: todo.context || null,
            sourceMessageId: msg.messageId,
            sourceSubject: msg.subject,
            sourceFrom: msg.from,
          }).returning().all()
          newTodosCount++
        }
      }

      console.log(`[Scheduler] 拉取 ${rawMessages.length} 封，新增 ${newTodosCount} 条待办`)
      onFetch?.({ fetched: rawMessages.length, newTodos: newTodosCount })
    } catch (error) {
      console.error('[Scheduler] 定时拉取失败:', error)
    }
  })

  console.log(`[Scheduler] 定时拉取已启动: ${cronExpression}`)
}

/** 停止定时拉取 */
export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
    console.log('[Scheduler] 定时拉取已停止')
  }
}

/** 获取调度器状态 */
export function isSchedulerRunning(): boolean {
  return scheduledTask !== null
}
