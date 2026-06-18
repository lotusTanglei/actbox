// src/lib/calendar/convert.ts — 邮件→事件/待办映射。plan-16 Task 8。
export interface MailDraft {
  messageId: string
  subject: string | null
  from: string | null
  body: string | null
  accountId?: number | null
}

export function mailToEventDraft(mail: MailDraft) {
  return {
    title: mail.subject || '(无主题)',
    description: (mail.body || '').slice(0, 200),
    sourceMessageId: mail.messageId,
    accountId: mail.accountId ?? null,
  }
}

export function mailToTodoDraft(mail: MailDraft) {
  return {
    title: (mail.subject || '(无主题)').slice(0, 200),
    sourceMessageId: mail.messageId,
    sourceSubject: mail.subject,
    sourceFrom: mail.from,
  }
}
