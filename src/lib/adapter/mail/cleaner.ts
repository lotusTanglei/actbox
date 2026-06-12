// src/lib/adapter/mail/cleaner.ts

import { htmlToText } from 'html-to-text'

/**
 * 清洗邮件正文：HTML → 纯文本，去引用/签名
 */
export function cleanEmailBody(
  html: string | undefined,
  text: string | undefined
): string {
  // 优先用纯文本（如果有的话）
  if (text && text.trim().length > 20) {
    return removeQuotedText(text.trim())
  }

  // HTML 转纯文本
  if (html) {
    const plain = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' as const },
        { selector: 'style', format: 'skip' as const },
        { selector: 'script', format: 'skip' as const },
      ],
    })
    return removeQuotedText(plain.trim())
  }

  return ''
}

/**
 * 去除邮件引用/转发部分
 */
function removeQuotedText(text: string): string {
  // 常见引用分隔符
  const patterns = [
    /-{2,}.*原始邮件.*-{2,}/,
    /On .+ wrote:/i,
    /\d{4}年\d{1,2}月\d{1,2}日.+写道：/,
    /\n发件人[:：]/,
    /\nFrom[:：]/,
    /\n>\s*.+/,
  ]

  let cleaned = text
  for (const pattern of patterns) {
    const match = cleaned.search(pattern)
    if (match > 10) {
      cleaned = cleaned.substring(0, match).trim()
    }
  }

  return cleaned
}
