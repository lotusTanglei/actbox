// src/app/api/events/route.ts
// SSE 推送 eventBus 事件:text/event-stream + 立即心跳 + Last-Event-ID 状态追赶。
// 长连接需 nodejs runtime(本地自托管,不可 Serverless)。plan-06 Task 5。

import { eventBus } from '@/lib/events/eventBus'
import type { EventEnvelope } from '@/lib/events/types'

export const dynamic = 'force-dynamic' // 禁静态化
export const runtime = 'nodejs' // 长连接需 nodejs runtime

function formatSSE(e: EventEnvelope): string {
  return `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`
}

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder()
  const lastEventId = Number(req.headers.get('last-event-id') ?? 0)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 状态追赶:补发 buffer 中 seq > lastEventId 的事件
      for (const e of eventBus.since(lastEventId)) {
        controller.enqueue(encoder.encode(formatSSE(e)))
      }
      // 2. 立即心跳(防首读阻塞) + 每 25s(防代理/浏览器空闲断开)
      controller.enqueue(encoder.encode(': keepalive\n\n'))
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          /* controller 已关 */
        }
      }, 25_000)
      // 3. 订阅实时事件
      const off = eventBus.subscribe((e) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(e)))
        } catch {
          /* ignore */
        }
      })
      // 4. 清理
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        off()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // nginx 不缓冲
    },
  })
}
