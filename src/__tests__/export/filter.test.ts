import { describe, it, expect } from 'vitest'
import { filterTodosForExport } from '@/lib/export/filter'
import type { TodoExportRow } from '@/lib/export/markdown'

const row = (over: Partial<TodoExportRow>): TodoExportRow => ({
  id: 1, title: 't', status: 'pending', priority: null, context: null,
  dueDate: null, sourceMessageId: null, sourceSubject: null, sourceMailPk: null, ...over,
})

describe('filterTodosForExport', () => {
  it('status=pending 只留 pending', () => {
    const got = filterTodosForExport(
      [row({ id: 1, status: 'pending' }), row({ id: 2, status: 'done' })],
      { status: 'pending', priorities: [], context: undefined, onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('priorities 非空只留匹配优先级（null 被排除）', () => {
    const got = filterTodosForExport(
      [row({ id: 1, priority: 'high' }), row({ id: 2, priority: 'low' }), row({ id: 3, priority: null })],
      { status: 'all', priorities: ['high', 'medium'], context: undefined, onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('context 大小写不敏感精确匹配', () => {
    const got = filterTodosForExport(
      [row({ id: 1, context: 'Work' }), row({ id: 2, context: 'work-out' }), row({ id: 3, context: 'work' })],
      { status: 'all', priorities: [], context: 'WORK', onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1, 3])
  })
  it('onlyLinked 只留有来源邮件的行', () => {
    const got = filterTodosForExport(
      [row({ id: 1, sourceMailPk: 5 }), row({ id: 2, sourceMailPk: null })],
      { status: 'all', priorities: [], context: undefined, onlyLinked: true },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('多条件 AND 组合', () => {
    const got = filterTodosForExport(
      [row({ id: 1, status: 'pending', priority: 'high', context: 'work', sourceMailPk: 1 }),
       row({ id: 2, status: 'pending', priority: 'high', context: 'work', sourceMailPk: null }),
       row({ id: 3, status: 'done', priority: 'high', context: 'work', sourceMailPk: 1 })],
      { status: 'pending', priorities: ['high'], context: 'work', onlyLinked: true },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
})
