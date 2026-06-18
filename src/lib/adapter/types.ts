// src/lib/adapter/types.ts
// 邮件适配器统一接口与数据类型（plan-02 Task 7）。
// MailAdapter 为可插拔接口（IMAP / OAuth / POP3 各一实现）；RawMessage 扩展多账号/文件夹/UID 字段。

export interface FolderInfo {
  path: string
  displayName: string
  type: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'
  unreadCount?: number
  totalCount?: number
}

export interface SendParams {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string // 纯文本
  bodyHtml?: string
  attachments?: { filename: string; path?: string; content?: string; cid?: string }[]
  replyToMessageId?: string
  inReplyTo?: string
}

export interface AccountConfig {
  id: number
  email: string
  user: string
  authCode: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  displayName?: string
}

/** 统一消息格式（所有适配器输出） */
export interface RawMessage {
  messageId: string
  subject: string | null
  from: string | null
  to?: string | null
  cc?: string | null
  bcc?: string | null
  body: string // 清洗后的纯文本正文
  bodyHtml?: string | null
  receivedAt: Date | null
  // 多账号 / 文件夹 / UID（plan-01/02 新增）
  accountId?: number
  folder?: string
  imapUid?: number
  imapSeq?: number
  // 兼容旧字段（receiver 等暂用，Task 8 重构后可移除）
  source?: 'email' | 'lark' | 'dingtalk'
}

/** 邮件适配器接口（可插拔：IMAP / OAuth / POP3） */
export interface MailAdapter {
  testConnection(): Promise<{ ok: boolean; detail: string }>
  listFolders(): Promise<FolderInfo[]>
  fetch(opts: { folder: string; since?: Date; uidRange?: [number, number]; highestModSeq?: bigint }): Promise<RawMessage[]>
  send(params: SendParams): Promise<{ messageId: string; imapUid?: number }>
  move(uid: number, fromFolder: string, toFolder: string): Promise<void>
  markRead(uid: number, folder: string, isRead: boolean): Promise<void>
  delete(uid: number, folder: string): Promise<void>
}

/** 旧消息源适配器接口（保留兼容，receiver 暂实现；Task 8 后由 MailAdapter 取代） */
export interface SourceAdapter {
  fetchNew(): Promise<RawMessage[]>
}
