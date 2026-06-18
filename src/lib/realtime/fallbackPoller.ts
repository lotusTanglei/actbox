// src/lib/realtime/fallbackPoller.ts
// 降级轮询:node-cron 短间隔对所有 shouldPoll().poll===true 的账号跑增量拉取。
// IDLE supervisor 降级后接管。plan-06 Task 4。

import cron, { type ScheduledTask } from 'node-cron'
import { getRawDb } from '@/lib/db'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'
import { runFallbackPoll } from './health'
import { eventBus } from '@/lib/events/eventBus'

let task: ScheduledTask | null = null

export function startFallbackPoller(intervalSec = 30): void {
  if (task) return
  const expr = `*/${Math.max(1, intervalSec)} * * * * *` // 6 字段(含秒)
  task = cron.schedule(expr, async () => {
    try {
      const db = getRawDb()
      await runFallbackPoll(db, {
        getAdapter: (id) => getAdapter(id),
        publish: (e) => eventBus.publish(e),
      })
    } catch (e) {
      console.error('[fallbackPoller]', e instanceof Error ? e.message : e)
    }
  })
}

export function stopFallbackPoller(): void {
  task?.stop()
  task = null
}
