// src/lib/extractor/types.ts

/** 邮件原文（适配器层产出，Phase 3 会完整定义） */
export interface RawMessage {
  source: 'email' | 'lark' | 'dingtalk' // 预留多源
  messageId: string
  subject: string
  from: string
  body: string // 清洗后的纯文本正文
  receivedAt: Date
}

/** LLM 抽取出的单条待办 */
export interface ExtractedTodo {
  title: string // 待办事项标题
  dueDate?: string // 截止日期（自然语言原文，如"下周五前"）
  priority?: 'high' | 'medium' | 'low'
  context?: string // 原文中的关键上下文片段
}

/** 抽取引擎的完整输出 */
export interface ExtractResult {
  todos: ExtractedTodo[]
  sourceMessageId?: string // 来源邮件 ID（Phase 2 用）
  rawInput: string // 保留原文，方便调试
}

/** LLM 返回的 JSON 结构（用于类型校验） */
export interface LlmExtractionResponse {
  todos: Array<{
    title: string
    dueDate?: string
    priority?: 'high' | 'medium' | 'low'
    context?: string
    isActionable: boolean // LLM 判断是否需要行动
  }>
}
