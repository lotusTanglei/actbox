// src/lib/search/query-parser.ts
// Gmail 子集操作符解析器 → ParsedQuery。宽容解析:非法值退回 freeText。plan-07 Task 4。

export interface ParsedQuery {
  freeText: string
  from?: string
  to?: string
  subject?: string
  hasAttachment?: boolean
  after?: Date
  before?: Date
  isUnread?: boolean
  isStarred?: boolean
}

const OPS = ['from', 'to', 'subject', 'has', 'after', 'before', 'is'] as const
type Op = (typeof OPS)[number]

/** 解析 Gmail 子集查询。带引号值整体取;无冒号或非已知操作符的 token 进 freeText。 */
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { freeText: '' }
  if (!raw) return out
  const tokens = tokenize(raw)
  const free: string[] = []
  for (const tok of tokens) {
    const m = tok.match(/^([a-zA-Z]+):(.*)$/)
    if (!m) {
      free.push(tok)
      continue
    }
    const opRaw = m[1].toLowerCase()
    const val = m[2]
    if (!OPS.includes(opRaw as Op)) {
      free.push(tok)
      continue
    }
    const op = opRaw as Op
    if (op === 'has') {
      if (val.toLowerCase() === 'attachment') out.hasAttachment = true
      else free.push(tok)
    } else if (op === 'is') {
      if (val === 'unread') out.isUnread = true
      else if (val === 'starred') out.isStarred = true
      else free.push(tok)
    } else if (op === 'after' || op === 'before') {
      const d = parseDate(val)
      if (d) out[op] = d
      else free.push(tok)
    } else {
      // from / to / subject —— 去掉引号值的外层引号
      out[op] = stripQuotes(val)
    }
  }
  out.freeText = free.join(' ').trim()
  return out
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

function tokenize(raw: string): string[] {
  // 优先匹配 op:"带空格引号值",再匹配裸引号串,最后非空白
  const re = /([a-zA-Z]+:"(?:[^"\\]|\\.)*")|("(?:[^"\\]|\\.)*")|([^\s]+)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const t = m[0]
    if (m[2]) out.push(t.slice(1, -1)) // 裸引号串 → 去引号进 freeText
    else out.push(t)
  }
  return out
}

function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!m) return null
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isNaN(dt.getTime()) ? null : dt
}
