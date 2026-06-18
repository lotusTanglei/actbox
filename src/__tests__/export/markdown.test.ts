import { describe, it, expect } from 'vitest'
import { renderTodosMarkdown, buildExportFilename, type TodoExportRow, type ExportRange, type ExportOptions } from '@/lib/export/markdown'

const row = (over: Partial<TodoExportRow>): TodoExportRow => ({
  id: 1, title: 't', status: 'pending', priority: null, context: null,
  dueDate: null, sourceMessageId: null, sourceSubject: null, sourceMailPk: null, ...over,
})
const NOW = new Date('2026-06-17T01:00:00Z').getTime()
const baseOpts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  frontmatter: true, timezone: 'Asia/Shanghai', sourceBaseUrl: '/mails/', now: () => NOW, ...over,
})
const range = (over: Partial<ExportRange> = {}): ExportRange => ({
  granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false, ...over,
})

describe('renderTodosMarkdown - frontmatter', () => {
  it('frontmatter=true 输出 YAML 头', () => {
    const md = renderTodosMarkdown([row({ id: 1, title: 'A' })], range(), baseOpts())
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('export_source: actbox')
    expect(md).toContain('total: 1')
  })
  it('frontmatter=false 无 YAML 头', () => {
    const md = renderTodosMarkdown([row({ title: 'A' })], range(), baseOpts({ frontmatter: false }))
    expect(md.startsWith('---\n')).toBe(false)
    expect(md).toContain('- [ ] A')
  })
})

describe('renderTodosMarkdown - 复选框 + 元数据', () => {
  it('done → - [x]，pending → - [ ]', () => {
    const md = renderTodosMarkdown(
      [row({ id: 1, title: '已完成', status: 'done' }), row({ id: 2, title: '待办', status: 'pending' })],
      range(), baseOpts({ frontmatter: false }),
    )
    expect(md).toContain('- [x] 已完成')
    expect(md).toContain('- [ ] 待办')
  })
  it('截止/优先级/context/来源邮件', () => {
    const md = renderTodosMarkdown(
      [row({ id: 1, title: '跟进合同', dueDate: '2026-06-20', priority: 'high', context: '工作', sourceSubject: '客户回复', sourceMailPk: 42 })],
      range(), baseOpts({ frontmatter: false }),
    )
    expect(md).toContain('📅 2026-06-20')
    expect(md).toContain('🔴 high')
    expect(md).toContain('#工作')
    expect(md).toContain('📧 [客户回复](/mails/42)')
  })
  it('无关联邮件不输出 📧', () => {
    const md = renderTodosMarkdown([row({ title: 'a' })], range(), baseOpts({ frontmatter: false }))
    expect(md).not.toContain('📧')
  })
  it('空结果输出提示行', () => {
    const md = renderTodosMarkdown([], range(), baseOpts({ frontmatter: false }))
    expect(md).toContain('（该范围内暂无待办）')
  })
})

describe('buildExportFilename', () => {
  it('week → todos-2026-W25.md (June 17 is Wed of ISO W25)', () => {
    const f = buildExportFilename(range({ granularity: 'week', from: '2026-06-17' }), NOW)
    expect(f.name).toBe('todos-2026-W25.md')
  })
  it('month → todos-2026-06.md', () => {
    const f = buildExportFilename(range({ granularity: 'month', from: '2026-06-17' }), NOW)
    expect(f.name).toBe('todos-2026-06.md')
  })
  it('range → todos-FROM..TO.md', () => {
    const f = buildExportFilename(range({ granularity: 'range', from: '2026-06-10', to: '2026-06-17' }), NOW)
    expect(f.name).toBe('todos-2026-06-10..2026-06-17.md')
  })
  it('all → todos-all-YYYY-MM-DD.md', () => {
    const f = buildExportFilename(range({ granularity: 'all' }), NOW)
    expect(f.name).toBe('todos-all-2026-06-17.md')
  })
})
