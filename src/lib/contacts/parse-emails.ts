// src/lib/contacts/parse-emails.ts
// 从 from/to/cc/bcc 原始字符串解析 { name, email }[]。plan-09 Task 2。

export interface ParsedAddress {
  name: string
  email: string
}

/** 解析逗号分隔的地址字符串，返回去重列表（按 email） */
export function parseAddresses(raw: string | null): ParsedAddress[] {
  if (!raw || !raw.trim()) return []

  const seen = new Set<string>()
  const result: ParsedAddress[] = []

  // 按逗号分段（处理 "Name <email>, email2, ..." 格式）
  const segments = splitByComma(raw)

  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue

    // 匹配 "Name <email>" 格式
    const bracketMatch = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/)
    if (bracketMatch) {
      const name = bracketMatch[1].trim()
      const email = bracketMatch[2].trim().toLowerCase()
      if (email && /@/.test(email) && !seen.has(email)) {
        seen.add(email)
        result.push({ name, email })
      }
      continue
    }

    // 纯邮箱格式
    const emailMatch = trimmed.match(/^[\w.+-]+@[\w.-]+$/)
    if (emailMatch) {
      const email = trimmed.toLowerCase()
      if (!seen.has(email)) {
        seen.add(email)
        result.push({ name: '', email })
      }
    }
  }

  return result
}

/** 按逗号分段（处理括号内的逗号不过早切分） */
function splitByComma(raw: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ',' && depth === 0) {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  parts.push(raw.slice(start))
  return parts
}
