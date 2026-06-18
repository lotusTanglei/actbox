// src/__tests__/api/events.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from '@/app/api/events/route'
import { eventBus, resetEventBus } from '@/lib/events/eventBus'

function sse(req: Request) {
  return GET(req).then((res) => (res.body as ReadableStream<Uint8Array>).getReader())
}

describe('GET /api/events SSE', () => {
  beforeEach(() => resetEventBus())

  it('返回 text/event-stream + 立即心跳', async () => {
    const ac = new AbortController()
    const req = new Request('http://x/api/events', { signal: ac.signal })
    const res = await GET(req)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value!)).toMatch(/: keepalive|event: heartbeat/)
    ac.abort()
  })

  it('Last-Event-ID 触发状态追赶(补发 buffer 中 seq 之后的)', async () => {
    eventBus.publish({
      type: 'new-mail',
      payload: { messageId: 'm1', accountId: 1, folder: 'INBOX', subject: null, from: null },
    })
    const last = eventBus.lastSeq()
    const ac = new AbortController()
    const req = new Request('http://x/api/events', {
      headers: { 'Last-Event-ID': String(last - 1) },
      signal: ac.signal,
    })
    const reader = await sse(req)
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value!)
    expect(text).toContain('id: ' + last)
    expect(text).toContain('new-mail')
    ac.abort()
  })

  it('publish 后事件以 id:/event:/data: 写出', async () => {
    const ac = new AbortController()
    const req = new Request('http://x/api/events', { signal: ac.signal })
    const reader = await sse(req)
    await reader.read() // 消费初始 keepalive
    eventBus.publish({
      type: 'unread-count',
      payload: { accountId: 1, folder: 'INBOX', unread: 5, total: 9 },
    })
    const chunks: string[] = []
    for (let i = 0; i < 5; i++) {
      const { value } = await reader.read()
      chunks.push(new TextDecoder().decode(value!))
      if (chunks.join('').includes('unread-count')) break
    }
    expect(chunks.join('')).toMatch(/id: \d+\nevent: unread-count\ndata: \{.*"unread":5.*\}/)
    ac.abort()
  })
})
