// src/lib/refresh-bus.ts
// 退化为 eventBus 的薄封装(保留 emitRefresh/onRefresh 兼容旧调用方)。plan-06 Task 1。

import { eventBus } from './events/eventBus'

/** 触发全局刷新(待办/邮件计数等)——以 status 事件承载。 */
export function emitRefresh(): void {
  eventBus.publish({ type: 'status', payload: { accountId: 0, status: 'healthy' } })
}

/** 订阅刷新事件(任何事件都触发旧式刷新),返回取消订阅函数。 */
export function onRefresh(fn: () => void): () => void {
  return eventBus.subscribe(() => fn())
}
