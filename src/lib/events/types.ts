// src/lib/events/types.ts
// 实时事件类型 + 信封。plan-06 Task 1。

export type MailEvent =
  | {
      type: 'new-mail'
      payload: {
        messageId: string
        accountId: number
        folder: string
        subject: string | null
        from: string | null
      }
    }
  | {
      type: 'unread-count'
      payload: { accountId: number; folder: string; unread: number; total: number }
    }
  | {
      type: 'message-updated'
      payload: {
        messageId: string
        accountId: number
        folder: string
        changes: { isRead?: boolean; isStarred?: boolean; folder?: string }
      }
    }
  | {
      type: 'status'
      payload: { accountId: number; status: 'healthy' | 'syncing' | 'error' | 'disabled'; error?: string }
    }

export type MailEventType = MailEvent['type']
export type MailEventPayload = MailEvent['payload']

export interface EventEnvelope {
  seq: number // 单调递增,SSE event id(状态追赶 + 幂等去重键)
  type: MailEventType
  payload: MailEventPayload
  id: string // 业务幂等键,客户端去重
  ts: number
}
