// src/lib/utils/debounce.ts
// 简单 debounce:连续调用在 ms 内只触发最后一次;cancel 取消;flush 立即触发(卸载防丢失)。plan-05 Task 7。

export type Debounced<T extends (...args: any[]) => void> = T & {
  cancel: () => void
  flush: () => void
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: any[] | null = null

  const debounced = (...args: any[]) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (lastArgs) fn(...lastArgs)
    }, ms)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  debounced.flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer)
      timer = null
      fn(...lastArgs)
    }
  }

  return debounced as Debounced<T>
}
