// src/lib/adapter/mail/presets.ts
// 主流邮箱服务商预设（一键添加账号时自动填 host/port）。

export type ProviderId = '163' | '126' | 'qq' | 'gmail' | 'outlook' | 'custom'

export interface ProviderPreset {
  provider: ProviderId
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  secure: boolean // SMTP SSL（465）；false 表示 STARTTLS（587）
  oauth?: boolean // 是否需要 OAuth2（而非授权码）
}

export const PRESETS: ProviderPreset[] = [
  { provider: '163', imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465, secure: true },
  { provider: '126', imapHost: 'imap.126.com', imapPort: 993, smtpHost: 'smtp.126.com', smtpPort: 465, secure: true },
  { provider: 'qq', imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465, secure: true },
  { provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, secure: true, oauth: true },
  { provider: 'outlook', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, secure: false, oauth: true },
]

export function getPreset(provider: string): ProviderPreset | null {
  return PRESETS.find((p) => p.provider === provider) ?? null
}
