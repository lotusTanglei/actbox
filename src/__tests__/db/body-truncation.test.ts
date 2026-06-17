// src/__tests__/db/body-truncation.test.ts
// 静态断言：入库处不再把 body 截断到 500 字（plan-01 Task 4）。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('body 入库不再截断到 500', () => {
  const files = [
    'src/app/api/fetch/route.ts',
    'src/app/api/send/route.ts',
    'src/lib/scheduler/index.ts',
  ]
  for (const f of files) {
    it(`${f} 不含 body 的 substring(0, 500)`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/body[^]*substring\(\s*0\s*,\s*500\s*\)/)
    })
  }
})
