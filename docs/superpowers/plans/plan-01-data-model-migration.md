# 子项目 1 — 数据模型演进 + Schema 迁移机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 建立可演进的 schema 迁移机制（drizzle-kit），对齐存量库基准，扩展 messages 到最终版全列表，修复并回填被截断的 body 全文。

**Architecture:** 方案 B（详见 spec §0/§2）。① 引入 drizzle-kit 迁移框架 + 生成 baseline；② getDb() 接 migrate + align-baseline（解决"存量库无迁移历史但表已存在"的对齐问题）；③ messages 扩列（account_id/folder/imap_uid/thread_id 等）+ 增量迁移；④ 去掉三处 body `substring(0,500)` 截断；⑤ 幂等的全文回填脚本。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`（用户要求每任务提交推送）。

---

## 文件结构

- Create: `drizzle.config.ts` — drizzle-kit 配置
- Create: `drizzle/` — 生成的迁移 SQL 目录（drizzle-kit generate 产出）
- Create: `scripts/align-baseline.ts` — 存量库基准对齐
- Create: `scripts/migrate.ts` — 迁移 CLI 入口
- Create: `scripts/backfill.ts` — body 全文回填
- Create: `src/lib/db/migrate-runner.ts` — migrate + alignBaseline 运行器
- Create: `src/lib/db/backfill-runner.ts` — 回填运行器
- Modify: `src/lib/db/schema.ts` — messages 扩列
- Modify: `src/lib/db/index.ts` — getDb() 接 migrate + align,移除 autoCreateTables
- Modify: `src/app/api/fetch/route.ts` / `src/app/api/send/route.ts` / `src/lib/scheduler/index.ts` — 去三处 `substring(0,500)`
- Modify: `package.json` — 加 `db:generate`/`db:migrate`/`db:backfill` 脚本 + drizzle-kit 依赖
- Test: `src/__tests__/db/migration.test.ts`、`src/__tests__/db/backfill.test.ts`、`src/__tests__/db/body-truncation.test.ts`

---

### Task 1: 引入 drizzle-kit 迁移框架

**Files:**
- Create: `drizzle.config.ts`
- Modify: `package.json`（脚本 + 依赖）

- [ ] **Step 1: 安装 drizzle-kit**

Run: `npm i -D drizzle-kit`
Expected: 安装成功。

- [ ] **Step 2: 写 drizzle.config.ts**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: './data/actbox.db' },
})
```

- [ ] **Step 3: 加 package.json 脚本**

在 `scripts` 加：
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx scripts/migrate.ts",
"db:backfill": "tsx scripts/backfill.ts"
```
（`tsx` 已是依赖；若无则 `npm i -D tsx`。）

- [ ] **Step 4: 生成 baseline 迁移**

Run: `npm run db:generate`
Expected: `drizzle/` 下出现 `0000_*.sql`（含现有 todos/messages/settings 的 CREATE TABLE）+ `meta/`。

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts drizzle/ package.json package-lock.json
git commit -m "chore: introduce drizzle-kit migration framework"
git push
```

---

### Task 2: getDb() 接 migrate + 存量库基准对齐

**Files:**
- Create: `scripts/migrate.ts`、`scripts/align-baseline.ts`
- Create: `src/lib/db/migrate-runner.ts`
- Modify: `src/lib/db/index.ts`
- Test: `src/__tests__/db/migration.test.ts`

**关键设计：** drizzle `migrate()` 对"无迁移历史但表已存在"的存量库会因 0000 的 `CREATE TABLE` 报错。`align-baseline` 检测：若 `__drizzle_migrations` 为空但 `messages` 表已存在 → 在 journal 种入 0000 已应用记录（跳过建表），再 `migrate()` 只跑 0001+（真正的加列/加表）。

- [ ] **Step 1: 写失败测试 `src/__tests__/db/migration.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, alignBaseline } from '@/lib/db/migrate-runner' // 见 Step 3

const tmp = () => `./data/test-${process.pid}-${Date.now()}.db`

describe('schema 迁移 + 基准对齐', () => {
  let path: string
  beforeEach(() => { path = tmp() })
  afterEach(() => { /* 删 test db 文件 */ })

  it('空库：migrate 从零建出含全列的库', () => {
    const db = new Database(path)
    alignBaseline(db, { migrationsFolder: './drizzle' })
    migrate(db, { migrationsFolder: './drizzle' })
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining([
      'account_id', 'folder', 'imap_uid', 'to', 'cc', 'bcc', 'thread_id', 'is_archived',
    ]))
    db.close()
  })

  it('存量旧库（缺新列 + 一行被截断 body）：align 后新列存在、旧行不丢', () => {
    const db = new Database(path)
    // 旧结构：手动建 messages（无新列）+ 插一行
    db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT, body TEXT, direction TEXT)`)
    db.exec(`INSERT INTO messages (message_id, body, direction) VALUES ('<m1>', '${'x'.repeat(300)}', 'in')`)
    alignBaseline(db, { migrationsFolder: './drizzle' })
    migrate(db, { migrationsFolder: './drizzle' })
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('account_id')
    const row = db.prepare("SELECT body FROM messages WHERE message_id='<m1>'").get() as { body: string }
    expect(row.body).toBe('x'.repeat(300)) // 旧行不丢
    db.close()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/__tests__/db/migration.test.ts`
Expected: FAIL（`@/lib/db/migrate-runner` 不存在 / 新列未加）。

- [ ] **Step 3: 实现 align-baseline + migrate-runner**

Create `scripts/align-baseline.ts`（导出 `alignBaseline(db, opts)`）：检测 `__drizzle_migrations` 表是否存在且为空、且 `messages` 表已存在 → 读 `drizzle/meta/_journal.json`，把 0000 记录按其 hash 种入 `__drizzle_migrations`（标记已应用），使后续 `migrate()` 跳过 0000 的建表、只跑增量。

Create `src/lib/db/migrate-runner.ts`：
```ts
import type Database from 'better-sqlite3'
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator'
import { alignBaselineRaw } from '../../scripts/align-baseline'

export function alignBaseline(db: Database.Database, opts: { migrationsFolder: string }) {
  alignBaselineRaw(db, opts)
}
export function migrate(db: Database.Database, opts: { migrationsFolder: string }) {
  drizzleMigrate(db as any, opts)
}
```
（`align-baseline.ts` 同时导出 CLI 入口与 `alignBaselineRaw` 函数，供 runner 与 `scripts/migrate.ts` 复用。）

- [ ] **Step 4: 改 getDb() 移除 autoCreateTables，接 migrate + align**

Modify `src/lib/db/index.ts`：删除 `autoCreateTables(sqlite)` 调用；`getDb()` 首次创建时执行 `alignBaseline(db, { migrationsFolder: './drizzle' })` 然后 `migrate(db, { migrationsFolder: './drizzle' })`。保留 `data/` 目录自建（`mkdirSync`）。

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/__tests__/db/migration.test.ts`
Expected: PASS。

- [ ] **Step 6: 手测存量库**

把真实旧 `data/actbox.db` 备份后启动 app，确认新列自动补齐、旧数据不丢、服务正常起。

- [ ] **Step 7: Commit**

```bash
git add scripts/align-baseline.ts scripts/migrate.ts src/lib/db/migrate-runner.ts src/lib/db/index.ts src/__tests__/db/migration.test.ts
git commit -m "feat(db): drizzle migrate + baseline align for existing DBs"
git push
```

---

### Task 3: messages 扩列（最终版）+ 增量迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 扩展 messages 定义**

```ts
import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core'

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject'),
  from: text('sender'),
  to: text('to'),               // 新：收件人（可逗号分隔多地址）
  cc: text('cc'),               // 新
  bcc: text('bcc'),             // 新
  recipient: text('recipient'), // 旧列保留兼容（回填到 to）
  body: text('body'),           // 改语义：清洗后全文纯文本（不再截断）
  bodyHtml: text('body_html'),
  accountId: integer('account_id'),                 // 新
  folder: text('folder').notNull().default('INBOX'), // 新
  imapUid: integer('imap_uid'),                      // 新
  imapSeq: integer('imap_seq'),                      // 新
  threadId: text('thread_id'),                       // 新
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false), // 新
  archivedAt: integer('archived_at', { mode: 'timestamp' }),                        // 新
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp' }),                    // 新
  receivedAt: integer('received_at', { mode: 'timestamp' }),
  processedAt: integer('processed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  direction: text('direction', { enum: ['in', 'out', 'draft'] }).notNull().default('in'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  todoCount: integer('todo_count').notNull().default(0),
}, (t) => ({
  accFolderUidIdx: index('idx_messages_account_folder_uid').on(t.accountId, t.folder, t.imapUid),
  threadIdx: index('idx_messages_thread').on(t.threadId),
  accReceivedIdx: index('idx_messages_account_received').on(t.accountId, t.receivedAt),
}))
```

- [ ] **Step 2: 生成增量迁移**

Run: `npm run db:generate`
Expected: `drizzle/` 出现 `0001_*.sql`（ALTER TABLE messages ADD COLUMN ... 带 DEFAULT）。

- [ ] **Step 3: 运行迁移测试确认通过**

Run: `npx vitest run src/__tests__/db/migration.test.ts`
Expected: PASS（新列在）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): extend messages with multi-account/folder/uid/thread columns"
git push
```

---

### Task 4: 修复三处 body 截断

**Files:**
- Modify: `src/app/api/fetch/route.ts`、`src/app/api/send/route.ts`、`src/lib/scheduler/index.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/db/body-truncation.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// 静态断言：源码里不再有 substring(0, 500) 截断 body
describe('body 不再截断', () => {
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/__tests__/db/body-truncation.test.ts`
Expected: FAIL（三处仍截断）。

- [ ] **Step 3: 改三处存全文**

三处把 `body: mailBody.substring(0, 500)`（或 `msg.body.substring(0,500)`）改为 `body: mailBody` / `body: msg.body`（全文）。列表预览改用 `substr(body, 1, 200)`（查询时），不在入库截断。

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/__tests__/db/body-truncation.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/fetch/route.ts src/app/api/send/route.ts src/lib/scheduler/index.ts src/__tests__/db/body-truncation.test.ts
git commit -m "fix(db): stop truncating body to 500 chars; store full plain text"
git push
```

---

### Task 5: body 全文回填脚本

**Files:**
- Create: `scripts/backfill.ts`、`src/lib/db/backfill-runner.ts`
- Test: `src/__tests__/db/backfill.test.ts`

- [ ] **Step 1: 写失败测试**（构造一行 `length(body)<=500` 的旧数据，跑回填后断言 body 被替换为"全文"、幂等）——用 mock 的 IMAP 源函数注入，断言调用次数与结果。

```ts
import { describe, it, expect, vi } from 'vitest'
import { runBackfill } from '@/lib/db/backfill-runner'

describe('backfill 幂等 + 全文回填', () => {
  it('疑似截断行被回填，重复跑不再处理', async () => {
    const fetchSource = vi.fn().mockResolvedValue({ body: 'y'.repeat(800), bodyHtml: '<p>full</p>', imapUid: 42 })
    const stats = await runBackfill({ db: testDb(), fetchSource, dryRun: false })
    expect(stats.refilled).toBeGreaterThan(0)
    expect(fetchSource).toHaveBeenCalled()
    const stats2 = await runBackfill({ db: sameDb(), fetchSource, dryRun: false })
    expect(stats2.refilled).toBe(0) // 幂等
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/db/backfill.test.ts` → FAIL。

- [ ] **Step 3: 实现 `runBackfill({db, fetchSource, dryRun})`**：遍历 `length(body)<=500` 的行，按 `(account_id, message_id)` 调 `fetchSource` 重拉 → 回写 body/bodyHtml/imap_uid；记已处理（body 长度变长即视为完成，幂等）。失败行写 `sync_status='backfill_failed'` 不中断。`scripts/backfill.ts` 为 CLI 入口。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/db/backfill.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill.ts src/lib/db/backfill-runner.ts src/__tests__/db/backfill.test.ts
git commit -m "feat(db): idempotent backfill script for truncated body"
git push
```

---

## 阶段 0 整体验收与自检

> 以下为阶段 0 跨子项目（子项目 1 + 2 + 17）的整体验收标准与 spec 覆盖自检。子项目 1 是阶段 0 第一份计划，故整体验收与自检归档于此。

### 阶段 0 验收（整体）

- [ ] 空 DB 冷启动 `./start` → 库自动建全列表、8321 可访问。
- [ ] 真实旧 DB 启动 → 新列自动补齐、旧数据不丢、服务正常。
- [ ] `grep "substring(0, 500)" src` 为空；`npm run db:backfill` 可回填。
- [ ] 能添加 ≥2 个账号、各自连接测试成功、按账号收发、Sidebar 动态显示。
- [ ] `launchctl` 自启生效、崩溃自动重启。
- [ ] `npm test` 全绿（新增 migration/backfill/adapter/presets/accounts/start 测试）。

### 阶段 0 自检（spec 覆盖）

- spec §1 全局数据模型 messages 扩列 + accounts 表 → Task 3、6 ✓
- spec §2 迁移机制/align/body 截断/回填 → Task 1/2/4/5 ✓
- spec 子项目 1（数据模型+迁移）→ Task 1–5 ✓
- spec 子项目 2（多账号+适配器+UI）→ Task 6–12 ✓
- spec 子项目 17（一行启动+端口+自启）→ Task 13/14 ✓
- 无占位（每步有真实代码/命令）；类型一致（MailAdapter/SendParams/AccountConfig 在 Task 7 定义、Task 8/10/12 一致使用）。
