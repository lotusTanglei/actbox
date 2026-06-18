// src/app/api/todos/export/download/route.ts — POST 下载导出
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { renderTodosMarkdown, buildExportFilename, type TodoExportRow, type ExportRange } from '@/lib/export/markdown'
import { filterTodosForExport } from '@/lib/export/filter'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const range: ExportRange = {
    granularity: body.granularity || 'all',
    dateField: body.dateField || 'created',
    from: body.from,
    to: body.to,
    status: body.status || 'all',
    priorities: Array.isArray(body.priorities) ? body.priorities : [],
    context: body.context || undefined,
    onlyLinked: body.onlyLinked === true,
  }
  const db = getRawDb()

  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.context, t.due_date AS dueDate,
           t.source_message_id AS sourceMessageId, m.subject AS sourceSubject, m.id AS sourceMailPk
    FROM todos t
    LEFT JOIN messages m ON t.source_message_id = m.message_id
    ORDER BY
      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      t.due_date ASC NULLS LAST,
      t.created_at DESC
  `).all() as TodoExportRow[]

  const filtered = filterTodosForExport(rows, range)
  const nowMs = Date.now()
  const md = renderTodosMarkdown(filtered, range, {
    frontmatter: body.frontmatter !== false,
    timezone: body.timezone || 'Asia/Shanghai',
    sourceBaseUrl: '/mails/',
    now: () => nowMs,
  })
  const fileName = buildExportFilename(range, nowMs)

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName.name}"`,
    },
  })
}
