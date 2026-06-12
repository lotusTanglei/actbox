// src/lib/adapter/types.ts

/** 统一消息格式（所有消息源适配器的输出） */
export interface RawMessage {
  source: 'email' | 'lark' | 'dingtalk'
  messageId: string
  subject: string
  from: string
  body: string // 清洗后的纯文本正文
  bodyHtml?: string // HTML 原文（可选）
  receivedAt: Date
}

/** 消息源适配器接口（可插拔） */
export interface SourceAdapter {
  /** 拉取新消息 */
  fetchNew(): Promise<RawMessage[]>
}
