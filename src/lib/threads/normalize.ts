// src/lib/threads/normalize.ts
// 会话聚合：规范化 Subject + 从邮件头提取 References/In-Reply-To 根 Message-ID。
// plan-08 Task 2。

/**
 * 规范化 Subject 以做会话聚合：
 * - 小写化
 * - 反复剥离开头的 Re:/Aw:/Fwd:/Fw:/Wg: 等前缀（含中括号变体 [xxx]）
 * - 折叠多余空白
 * - 空/null 返回 ''
 */
export function normalizeSubject(subject: string | null): string {
  if (!subject || !subject.trim()) return ''
  let s = subject.trim()
  // 反复剥离常见前缀(Re/Aw/Fwd/Fw/Wg 等，大小写不敏感)，不限行首（可出现在 [External] 等 tag 之后）
  const prefixRe = /\b(?:re|aw|fwd|fw|wg)\s*:\s*/gi
  let changed = true
  while (changed) {
    const prev = s
    s = s.replace(prefixRe, '').trim()
    changed = s !== prev
  }
  // 折叠空白 + 小写化（[External] 等标签保留，仅小写）
  return s.toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 从邮件头提取会话根 Message-ID。
 * 优先 References 的第一个（最老根），否则 In-Reply-To。
 * 均无返回 null。去尖括号。
 */
export function extractRootMessageId(headers: {
  inReplyTo: string | null
  references: string | null
}): string | null {
  const refs = parseMessageIds(headers.references || '')
  if (refs.length > 0) return refs[0]

  const irt = parseMessageIds(headers.inReplyTo || '')
  if (irt.length > 0) return irt[0]

  return null
}

/** 解析含尖括号的 Message-ID 列表，去尖括号返回 */
function parseMessageIds(raw: string): string[] {
  if (!raw || !raw.trim()) return []
  const ids: string[] = []
  // 匹配 <id> 或裸 id（空格分隔）
  const re = /<([^>]+)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    ids.push(m[1])
  }
  // 如果没匹配到尖括号，尝试按空格分隔（裸 Message-ID）
  if (ids.length === 0) {
    return raw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return ids
}
