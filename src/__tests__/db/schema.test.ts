// src/__tests__/db/schema.test.ts

import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { todos, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { alignBaseline, migrate } from '@/lib/db/migrate-runner'

// 用内存 SQLite 测试，不污染真实 DB
let db: ReturnType<typeof drizzle>

beforeAll(() => {
  const sqlite = Database(':memory:')
  db = drizzle(sqlite, { schema })
  // 用真实迁移建表，保证测试库 schema 始终与 schema.ts 一致（随 plan-01 扩列自动跟进）
  alignBaseline(sqlite, { migrationsFolder: './drizzle' }) // 空库：no-op
  migrate(db, { migrationsFolder: './drizzle' })
})

describe('Todos CRUD', () => {
  it('should insert a todo', () => {
    const result = db
      .insert(todos)
      .values({
        title: '测试待办',
        priority: 'high',
        dueDate: '下周五前',
      })
      .returning()
      .all()

    expect(result[0].id).toBeDefined()
    expect(result[0].title).toBe('测试待办')
    expect(result[0].status).toBe('pending')
    expect(result[0].priority).toBe('high')
  })

  it('should toggle todo status', () => {
    const inserted = db.insert(todos).values({ title: '待完成' }).returning().all()
    const id = inserted[0].id

    db.update(todos).set({ status: 'done' }).where(eq(todos.id, id)).run()

    const updated = db.select().from(todos).where(eq(todos.id, id)).all()
    expect(updated[0].status).toBe('done')
  })

  it('should delete a todo', () => {
    const inserted = db.insert(todos).values({ title: '待删除' }).returning().all()
    const id = inserted[0].id

    db.delete(todos).where(eq(todos.id, id)).run()

    const remaining = db.select().from(todos).where(eq(todos.id, id)).all()
    expect(remaining).toHaveLength(0)
  })
})

describe('Messages dedup', () => {
  it('should enforce unique messageId', () => {
    db.insert(messages).values({
      messageId: 'msg-001',
      subject: '测试邮件',
      from: 'test@test.com',
    }).run()

    // 重复插入应该抛错
    expect(() => {
      db.insert(messages).values({
        messageId: 'msg-001',
        subject: '重复邮件',
      }).run()
    }).toThrow()
  })
})
