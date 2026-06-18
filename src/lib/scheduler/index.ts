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

  // 启动实时:IDLE supervisor(每活跃 idle 账号)+ 降级轮询。plan-06 Task 8
  import('@/lib/realtime/startSupervisors')
    .then(({ startSupervisors }) => startSupervisors())
    .catch((e) => console.error('[Scheduler] supervisors start failed', e))

  scheduledTask = cron.schedule(cronExpression, async () => {
    try {
      console.log('[Scheduler] 开始定时拉取...')
      const { syncActiveAccounts } = await import('@/lib/sync/syncEngine')
      const summary = await syncActiveAccounts()
      console.log(
        `[Scheduler] 拉取 ${summary.totalFetched} 封,新增 ${summary.totalNewTodos} 条待办,失败账号 ${summary.accountErrors} 个`,
      )
      onFetch?.({ fetched: summary.totalFetched, newTodos: summary.totalNewTodos })
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
