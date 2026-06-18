import { describe, it, expect } from 'vitest'
import { applyTemplate, extractVariables } from '@/lib/templates/render'

describe('applyTemplate', () => {
  it('替换单个变量', () => {
    expect(applyTemplate('你好 {{name}}', { name: '张三' })).toBe('你好 张三')
  })
  it('替换多个不同变量', () => {
    expect(applyTemplate('{{greeting}}, {{name}}', { greeting: 'Hi', name: '李四' })).toBe('Hi, 李四')
  })
  it('未提供变量 → 留空', () => {
    expect(applyTemplate('你好 {{name}}', {})).toBe('你好 ')
  })
  it('变量名含下划线/数字', () => {
    expect(applyTemplate('{{due_date}} / {{item1}}', { due_date: '06-18', item1: 'X' })).toBe('06-18 / X')
  })
  it('同名变量多处都替换', () => {
    expect(applyTemplate('{{name}}-{{name}}', { name: 'A' })).toBe('A-A')
  })
  it('保留 HTML 结构', () => {
    expect(applyTemplate('<p>{{x}}</p>', { x: '<b>' })).toBe('<p><b></p>')
  })
})

describe('extractVariables', () => {
  it('抽出变量名去重', () => {
    expect(extractVariables('{{name}} 和 {{name}} 与 {{date}}')).toEqual(['name', 'date'])
  })
  it('无变量 → 空数组', () => {
    expect(extractVariables('普通文本')).toEqual([])
  })
})
