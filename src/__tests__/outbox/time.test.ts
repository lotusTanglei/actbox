import { describe, it, expect } from 'vitest'
import { nowUtcMs, toLocalDisplay, parseLocalToUtc } from '@/lib/outbox/time'

describe('nowUtcMs', () => {
  it('返回当前 epoch 毫秒', () => {
    const before = Date.now()
    const v = nowUtcMs()
    const after = Date.now()
    expect(v).toBeGreaterThanOrEqual(before)
    expect(v).toBeLessThanOrEqual(after)
  })
})

describe('toLocalDisplay', () => {
  it('UTC ms → Asia/Shanghai wall-clock', () => {
    const ms = Date.UTC(2026, 5, 18, 1, 0, 0)
    const d = toLocalDisplay(ms, 'Asia/Shanghai')
    expect(d.time).toBe('09:00')
    expect(d.date).toBe('2026-06-18')
  })
  it('跨天正确', () => {
    const ms = Date.UTC(2026, 5, 18, 23, 0, 0)
    const d = toLocalDisplay(ms, 'Asia/Shanghai')
    expect(d.date).toBe('2026-06-19')
    expect(d.time).toBe('07:00')
  })
})

describe('parseLocalToUtc', () => {
  it('上海 09:30 → UTC 01:30', () => {
    const ms = parseLocalToUtc({ date: '2026-06-18', time: '09:30' }, 'Asia/Shanghai')
    expect(new Date(ms).toISOString()).toBe('2026-06-18T01:30:00.000Z')
  })
  it('默认 tz = 系统本地(不抛)', () => {
    expect(() => parseLocalToUtc({ date: '2026-06-18', time: '09:30' })).not.toThrow()
  })
  it('非法输入抛错', () => {
    expect(() => parseLocalToUtc({ date: 'bad', time: '09:30' }, 'Asia/Shanghai')).toThrow()
  })
})
