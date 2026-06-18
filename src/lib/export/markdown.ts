// src/lib/export/markdown.ts — 待办导出 Markdown 渲染纯函数。plan-18 Task 1。
export type ExportGranularity = 'day' | 'week' | 'month' | 'range' | 'all'

export interface ExportRange {
  granularity: ExportGranularity
  dateField: 'created' | 'done' | 'due'
  from?: string
  to?: string
  status: 'all' | 'pending' | 'done'
  priorities: Array<'high' | 'medium' | 'low'>
  context?: string
  onlyLinked: boolean
}

export interface ExportOptions {
  frontmatter: boolean
  vaultPath?: string
  timezone?: string
  sourceBaseUrl?: string
  now?: () => number
}

export interface TodoExportRow {
  id: number
  title: string
  status: 'pending' | 'done'
  priority: 'high' | 'medium' | 'low' | null
  context: string | null
  dueDate: string | null
  sourceMessageId: string | null
  sourceSubject: string | null
  sourceMailPk: number | null
}

const PRIORITY_EMOJI: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' }

function formatExportAt(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const g = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const offset = getOffsetStr(tz, ms)
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}${offset}`
}

function getOffsetStr(tz: string, ms: number): string {
  const tzWall = new Date(ms).toLocaleString('en-US', { timeZone: tz })
  const tzAsEpoch = Date.parse(tzWall)
  const utcWall = new Date(ms).toLocaleString('en-US', { timeZone: 'UTC' })
  const utcAsEpoch = Date.parse(utcWall)
  const totalMin = Math.round((tzAsEpoch - utcAsEpoch) / 60_000)
  const sign = totalMin < 0 ? '-' : '+'
  const abs = Math.abs(totalMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

/** ISO 周号(周四所在年 + 周序) */
function isoWeek(ymd: string): { year: number; week: number } {
  const d = new Date(ymd + 'T00:00:00Z')
  const thu = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86400000)
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return { year: thu.getUTCFullYear(), week }
}

/** 按范围生成文件名与 rangeLabel */
export function buildExportFilename(
  range: Pick<ExportRange, 'granularity' | 'from' | 'to'>,
  nowMs: number,
): { name: string; stem: string; ext: string; rangeLabel: string } {
  const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  let stem = 'todos'; let rangeLabel = 'all'
  switch (range.granularity) {
    case 'day': {
      const d = range.from || toDate(nowMs); stem = `todos-${d}`; rangeLabel = d
      break
    }
    case 'week': {
      const d = range.from || toDate(nowMs)
      const w = isoWeek(d); stem = `todos-${w.year}-W${String(w.week).padStart(2, '0')}`; rangeLabel = `${w.year}-W${String(w.week).padStart(2, '0')}`
      break
    }
    case 'month': {
      const d = range.from || toDate(nowMs); const m = d.slice(0, 7); stem = `todos-${m}`; rangeLabel = m
      break
    }
    case 'range': {
      const f = range.from || '?'; const t = range.to || '?'; stem = `todos-${f}..${t}`; rangeLabel = `${f}..${t}`
      break
    }
    case 'all': {
      const d = toDate(nowMs); stem = `todos-all-${d}`; rangeLabel = 'all'
      break
    }
  }
  return { name: `${stem}.md`, stem, ext: 'md', rangeLabel }
}

/** 渲染待办为 Obsidian 友好 Markdown */
export function renderTodosMarkdown(rows: TodoExportRow[], range: ExportRange, opts: ExportOptions): string {
  const tz = opts.timezone || 'Asia/Shanghai'
  const sourceBase = opts.sourceBaseUrl || '/mails/'
  const nowMs = opts.now ? opts.now() : Date.now()
  const fileName = buildExportFilename(range, nowMs)
  let md = ''

  // frontmatter
  if (opts.frontmatter) {
    const exportAt = formatExportAt(nowMs, tz)
    md += '---\n'
    md += 'export_source: actbox\n'
    md += `export_at: ${exportAt}\n`
    md += `range: ${fileName.rangeLabel}\n`
    md += `date_field: ${range.dateField}\n`
    md += `status: ${range.status}\n`
    md += `total: ${rows.length}\n`
    md += '---\n\n'
  }

  // body
  if (rows.length === 0) {
    md += '> （该范围内暂无待办）\n'
    return md
  }

  for (const r of rows) {
    const check = r.status === 'done' ? '[x]' : '[ ]'
    let meta = ''
    if (r.dueDate) meta += ` 📅 ${r.dueDate}`
    if (r.priority && PRIORITY_EMOJI[r.priority]) meta += ` ${PRIORITY_EMOJI[r.priority]} ${r.priority}`
    if (r.context) meta += ` #${r.context.replace(/ /g, '_')}`
    if (r.sourceMailPk != null) {
      const subj = (r.sourceSubject || '(无主题)').replace(/\]/g, '\\]')
      meta += ` 📧 [${subj}](${sourceBase}${r.sourceMailPk})`
    }
    md += `- ${check} ${r.title}${meta}\n`
  }
  return md
}
