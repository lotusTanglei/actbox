// src/__tests__/utils/debounce.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '@/lib/utils/debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('连续调用 N 次在 ms 内只触发 1 次', () => {
    const fn = vi.fn()
    const d = debounce(fn, 1000)
    d()
    d()
    d()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('透传最新参数', () => {
    const fn = vi.fn()
    const d = debounce(fn, 500)
    d(1)
    d(2)
    d(3)
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('cancel 取消待发', () => {
    const fn = vi.fn()
    const d = debounce(fn, 1000)
    d()
    d.cancel()
    vi.advanceTimersByTime(2000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush 立即触发最后值(卸载时防丢失)', () => {
    const fn = vi.fn()
    const d = debounce(fn, 1000)
    d('a')
    d('b')
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })
})
