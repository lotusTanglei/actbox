// src/lib/export/filter.ts — 待办导出内存筛选纯函数。plan-18 Task 2。
import type { ExportRange, TodoExportRow } from './markdown'

/** 状态/优先级/context/来源邮件关联的纯筛选。日期段由端点 SQL 处理。 */
export function filterTodosForExport(
  rows: TodoExportRow[],
  range: Pick<ExportRange, 'status' | 'priorities' | 'context' | 'onlyLinked'>,
): TodoExportRow[] {
  return rows.filter((r) => {
    if (range.status === 'pending' && r.status !== 'pending') return false
    if (range.status === 'done' && r.status !== 'done') return false
    if (range.priorities.length > 0 && (!r.priority || !range.priorities.includes(r.priority))) return false
    if (range.context && (r.context || '').toLowerCase() !== range.context.toLowerCase()) return false
    if (range.onlyLinked && r.sourceMailPk == null) return false
    return true
  })
}
