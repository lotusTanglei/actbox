// src/__tests__/extractor/golden.test.ts

import { describe, it, expect } from 'vitest'
import { extractTodos } from '@/lib/extractor'
import { GOLDEN_EMAILS } from './fixtures'

/**
 * 金标准测试 — 需要真实 LLM API 调用
 * 运行方式: npm run test:golden
 * 普通测试不会执行（需要 RUN_GOLDEN_TESTS=true 且有 API key）
 */
const shouldRunGolden = process.env.RUN_GOLDEN_TESTS === 'true'

describe.runIf(shouldRunGolden)('Golden Tests - LLM Extraction', () => {
  GOLDEN_EMAILS.forEach(({ name, input, expectTodos, expectKeywords }) => {
    it(name, async () => {
      const result = await extractTodos(input)

      // 待办数量允许 ±1 的误差（LLM 输出不完全确定性）
      expect(result.todos.length).toBeGreaterThanOrEqual(Math.max(0, expectTodos - 1))
      expect(result.todos.length).toBeLessThanOrEqual(expectTodos + 1)

      // 关键词检查：至少一半的待办应该包含期望关键词
      if (expectKeywords.length > 0) {
        const titles = result.todos.map((t) => t.title).join(' ')
        const contexts = result.todos.map((t) => t.context || '').join(' ')
        const allText = titles + ' ' + contexts
        const matchedKeywords = expectKeywords.filter((kw) => allText.includes(kw))
        expect(matchedKeywords.length).toBeGreaterThanOrEqual(Math.ceil(expectKeywords.length / 2))
      }

      // 结果结构验证
      result.todos.forEach((todo) => {
        expect(todo.title).toBeTruthy()
        expect(todo.title.length).toBeGreaterThan(2)
      })
    }, 30_000) // LLM 调用需要较长超时
  })
})
