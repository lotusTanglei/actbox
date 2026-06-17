// src/lib/refresh-bus.ts
// 轻量的全局刷新通知机制（跨组件，不依赖 context）

type Listener = () => void
const listeners = new Set<Listener>()

/** 触发全局刷新（待办/邮件计数等） */
export function emitRefresh() {
  listeners.forEach((fn) => fn())
}

/** 订阅刷新事件，返回取消订阅函数 */
export function onRefresh(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
