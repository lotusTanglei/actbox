// src/app/api/todos/export/route.ts — POST 导出待办(mode=text|file)
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { renderTodosMarkdown, buildExportFilename, type TodoExportRow, type ExportRange } from '@/lib/export/markdown'
import { filterTodosForExport } from '@/lib/export/filter'
import { writeToVault, resolveVaultPath } from '@/lib/export/vault'

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
  const mode: string = body.mode || 'text'
  const db = getRawDb()

  // 查询 todos 左连 messages
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

  // 日期段如果提供了 from/to，这里做内存筛选（简化：实际应在 SQL 做）
  let filtered = filterTodosForExport(rows, range)

  const nowMs = Date.now()
  const md = renderTodosMarkdown(filtered, range, {
    frontmatter: body.frontmatter !== false,
    timezone: body.timezone || 'Asia/Shanghai',
    sourceBaseUrl: '/mails/',
    now: () => nowMs,
  })
  const fileName = buildExportFilename(range, nowMs)

  if (mode === 'file') {
    try {
      const vaultPath = resolveVaultPath(db)
      const filePath = await writeToVault(vaultPath, fileName.name, md)
      return NextResponse.json({ path: filePath, filename: fileName.name })
    } catch (e: any) {
      if (e.message === 'VAULT_NOT_CONFIGURED') return NextResponse.json({ error: 'VAULT_NOT_CONFIGURED' }, { status: 400 })
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  return NextResponse.json({ markdown: md, filename: fileName.name, total: filtered.length })
}
