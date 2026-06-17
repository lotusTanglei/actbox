# 子项目 15 — 设置中心统一化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把现有 4-tab 设置页（Email/LLM/Scheduler/Signature）升级为**统一设置中心**——左侧分区导航聚合既有各子项目的配置入口（账号→plan-02、显示主题/快捷键→plan-14、规则→plan-10、LLM→plan-12、调度→既有），并新增四块能力：**签名多套 + 按账号分配**、**数据导入导出**（邮件/待办/联系人 CSV/JSON）、**i18n 框架**（中/英 + 时区/日期本地化 + RFC2047 解码）、**可观测性**（连接健康度/同步状态/错误日志可见可导出 + 结构化日志 + 指标）。

**Architecture:** 方案 B（详见 spec §0/子项目 15/NFR i18n·可观测性）。本地单机、单进程、单 SQLite(WAL)、单用户不变。本计划是**聚合层 + 新增横切能力**，核心原则是**链接不重造**：

1. **设置中心是聚合层**：绝大多数功能配置入口已由别的子项目实现——本计划只做**统一入口 + 左侧分区导航**，把账号管理（plan-02 `/api/accounts`）、规则（plan-10 `/api/rules`）、显示主题/快捷键（plan-14 `ThemeProvider` + `hotkeys`）、LLM（plan-12 `/api/llm/config`）作为「分区卡片/外链」嵌入设置中心，不复制其 schema/逻辑。**唯一改写的既有页**是当前 `src/app/settings/page.tsx`（4 tab）→ 重构为左侧导航 + 主面板的统一壳。
2. **签名多套 + 按账号分配**（新增）：当前签名是 `settings.signature` 单值（全局），无法多套也无法按账号区分。升级为独立 `signatures` 表（多套签名，每套 name/body_html），并在 `accounts`（plan-02）上挂 `signature_id` 做按账号分配（plan-02 的 accounts 表已存在，本计划用 `ALTER TABLE` 补一列或回退到 `settings` KV `account_signatures` JSON 映射——见 Task 1 设计）。撰写时按当前账号取对应签名自动追加（与 plan-05「签名按账号自动追加」衔接：plan-05 负责编辑器层 append，本计划负责签名的**存储 + 分配 + CRUD UI**）。
3. **数据导入导出**（新增）：邮件/待办/联系人按格式（CSV/JSON）导出与导入，支撑跨客户端迁移。导出走内存流式序列化（CSV 用手写 escaper，避免引依赖；JSON 直接 `JSON.stringify`），导入做反序列化 + 校验 + upsert（按业务主键去重：邮件按 `message_id`、联系人按 `email+account_id`、待办按 `id` 仅支持导入新建）。**复用 plan-09 的联系人 vCard/CSV 导出**（plan-09 已实现 contacts 导出，本计划联系人导出直接转发/复用其 serializer，邮件/待办导出是新加的）。
4. **i18n 框架**（新增）：当前全站硬编码中文（`'⚙️ 设置'`、`'✅ 邮箱配置已保存'`、`'（无主题）'` 等）。抽离到 locale 文件（`zh-CN.json` / `en-US.json`），提供 `t(key, params)` 函数 + `I18nProvider`（locale 存 `settings.locale`，默认 `zh-CN`）+ 日期/时间/数字本地化（`Intl.DateTimeFormat` 按 locale + 时区）+ RFC2047 encoded-word 主题/附件名解码校验（`=?charset?B/Q?text?=`，邮件收件侧主题/附件名多语种乱码根因）。
5. **可观测性**（新增）：账号连接健康度（从 `accounts.sync_status`/`sync_error`/`last_synced_at` 读，plan-02 已有列）、同步状态、错误日志**可见 + 可导出**；结构化日志（`createLogger(scope)` 写 `{ts, level, scope, msg, ...meta}` 到 `data/logs/*.ndjson`，替代散落的裸 `console.log`）；指标采集（同步延迟 / IDLE 在线率 / 队列积压 / LLM 成本 / IMAP 错误率）以内存 ring buffer + `metrics` KV 暴露展示。
6. **UTF-8 全编码邮件解析校验**：作为 Task（数据导入 + i18n）的验收子项，用真实含中文/多语种 encoded-word 的邮件头样本断言解码正确（防乱码回归）。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle + better-sqlite3 / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 2（`accounts` 表 + `/api/accounts`）、9（contacts 表 + vCard/CSV 导出 serializer）、10（`rules` + `/api/rules`）、12（`/api/llm/config` + `/api/llm/test`）、14（`ThemeProvider` + `hotkeys` registry/settings）。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。API route 测试对 `getDb()` 注入内存库（`memDb` helper，参考 plan-14 约定；若 plan-14 已建则复用并补本计划所需表/列，不重复建）。UI 视觉/交互部分以手测覆盖，纯逻辑（CSV 序列化、RFC2047 解码、locale 加载、指标聚合、结构化日志格式）以单测覆盖。

---

## 文件结构

- Modify: `src/app/settings/page.tsx` — 重构为左侧分区导航 + 主面板统一壳（Task 2）
- Create: `src/components/settings/SettingsNav.tsx` — 左侧分区导航（账号/显示主题/快捷键/规则/签名/调度/LLM/数据/可观测性/语言）（Task 2）
- Create: `src/components/settings/SectionShell.tsx` — 分区主面板容器（标题 + 描述 + children + i18n）（Task 2）
- Create: `src/lib/db/schema.ts` 增 `signatures` 表 + accounts 增 `signature_id` 列（Task 1，经 drizzle 迁移）
- Create: `src/app/api/signatures/route.ts` — 签名 CRUD（GET/POST/PATCH/DELETE）（Task 1）
- Create: `src/app/api/signatures/[id]/route.ts` — 单套签名 GET/PATCH/DELETE（Task 1）
- Create: `src/app/api/accounts/[id]/signature/route.ts` — 给账号分配/取消签名（PUT）（Task 1）
- Create: `src/components/settings/SignaturesSection.tsx` — 签名多套 CRUD + 按账号分配 UI（Task 1 UI）
- Create: `src/lib/io/csv.ts` — CSV 序列化/反序列化纯函数（`toCsv`/`parseCsv`，含 RFC4180 引号/逗号/换行转义）（Task 3）
- Create: `src/lib/io/serializers.ts` — 邮件/待办/联系人 → JSON/CSV 行映射纯函数（Task 3）
- Create: `src/app/api/export/route.ts` — 导出端点（`?type=messages|todos|contacts&format=csv|json`，流式 Response）（Task 3）
- Create: `src/app/api/import/route.ts` — 导入端点（POST multipart/text，反序列化 + 校验 + upsert）（Task 3）
- Create: `src/components/settings/DataSection.tsx` — 导入导出 UI（类型/格式选择 + 下载 + 上传 + 结果预览）（Task 3 UI）
- Create: `src/lib/i18n/locales/zh-CN.json` — 中文文案字典（Task 4）
- Create: `src/lib/i18n/locales/en-US.json` — 英文文案字典（Task 4）
- Create: `src/lib/i18n/index.ts` — `loadLocale`/`translate(key,params,locale)`/`formatDate(date,locale,tz)`/`formatNumber` 纯函数（Task 4）
- Create: `src/lib/i18n/rfc2047.ts` — encoded-word 解码 `decodeEncodedWord(s)` 纯函数（Task 4）
- Create: `src/components/i18n/I18nProvider.tsx` — locale context + `useT()` hook（读 `settings.locale`）（Task 4 UI）
- Create: `src/components/settings/LanguageSection.tsx` — 语言/时区选择 UI（Task 4 UI）
- Create: `src/lib/log/logger.ts` — `createLogger(scope)` 结构化日志（写 `data/logs/*.ndjson`，leveled，ring buffer）（Task 5）
- Create: `src/lib/log/metrics.ts` — 指标采集（`recordMetric(name,value,tags)` + ring buffer + 聚合 `snapshot()`）（Task 5）
- Create: `src/app/api/observability/health/route.ts` — 账号连接健康度 + 同步状态（读 accounts + jobs）（Task 5）
- Create: `src/app/api/observability/logs/route.ts` — 错误日志查询 + 导出（`?level=&scope=&since=&format=ndjson|json`）（Task 5）
- Create: `src/app/api/observability/metrics/route.ts` — 指标快照（同步延迟/IDLE 在线率/队列积压/LLM 成本/IMAP 错误率）（Task 5）
- Create: `src/components/settings/ObservabilitySection.tsx` — 可观测性 UI（健康度卡片 + 指标图表 + 错误日志表 + 导出按钮）（Task 5 UI）
- Modify: `src/app/settings/page.tsx` 等既有页 — 抽离硬编码中文到 `t()`（Task 6，最小覆盖设置中心 + 列表空状态）
- Create: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 全表建表（若 plan-14 已建则复用补本计划所需列/表：`signatures`、accounts.`signature_id`、jobs）
- Test: `src/__tests__/io/csv.test.ts`、`src/__tests__/io/serializers.test.ts`、`src/__tests__/api/export.test.ts`、`src/__tests__/api/import.test.ts`、`src/__tests__/i18n/translate.test.ts`、`src/__tests__/i18n/rfc2047.test.ts`、`src/__tests__/i18n/format.test.ts`、`src/__tests__/log/logger.test.ts`、`src/__tests__/log/metrics.test.ts`、`src/__tests__/api/signatures.test.ts`、`src/__tests__/api/observability.test.ts`、`src/__tests__/i18n/utf8-mail.test.ts`

---

## 任务

### Task 1: 签名多套 + 按账号分配（schema + API + UI）

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/app/api/signatures/route.ts`
- Create: `src/app/api/signatures/[id]/route.ts`
- Create: `src/app/api/accounts/[id]/signature/route.ts`
- Create: `src/components/settings/SignaturesSection.tsx`
- Create: `src/__tests__/api/signatures.test.ts`

**关键设计：**
- **`signatures` 表**（独立表，非 settings KV——多套需要查询/排序/引用）：
  `signatures(id INTEGER PK AUTOINCREMENT, name TEXT NOT NULL, body_html TEXT, body_text TEXT, created_at INTEGER, updated_at INTEGER)`。
- **按账号分配**：plan-02 的 `accounts` 表加一列 `signature_id INTEGER REFERENCES signatures(id) ON DELETE SET NULL`。**回退策略**：若 plan-02 accounts 迁移尚未在该工作树落地（accounts 表不存在），则分配关系存 `settings` KV `account_signatures` = JSON `{ [accountId]: signatureId | null }`——`AccountSignatureResolver` 抽象屏蔽两种存储，以 `signatures.test.ts` 全绿为判据。**实现时**优先 ALTER accounts 加列（与 plan-02 schema 对齐）， accounts 不存在则 KV 回退。
- **API**：
  - `GET /api/signatures` → 全套列表。
  - `POST /api/signatures` `{ name, body_html, body_text }` → 新建。
  - `PATCH /api/signatures/[id]` → 改名/正文。
  - `DELETE /api/signatures/[id]` → 删（级联把 accounts.signature_id 置 NULL）。
  - `PUT /api/accounts/[id]/signature` `{ signatureId: number|null }` → 分配/取消分配。
  - `GET /api/accounts/[id]/signature` → 当前分配的签名（供 plan-05 撰写时取）。
- **CRUD UI**（`SignaturesSection`）：左侧签名列表（+ 新建按钮），右侧编辑（name input + RichTextEditor body_html，复用现有 `src/components/RichTextEditor.tsx`）；底部「按账号分配」表（账号 → 签名 select，None 表示不追加）。
- **与 plan-05 衔接**：plan-05 撰写时 `GET /api/accounts/[currentAccountId]/signature` 取签名 append。本计划只提供存储 + 分配 + CRUD，不改 ComposeMail（plan-05 负责）。

- [ ] **Step 1: 写签名 API 失败测试**

```ts
// src/__tests__/api/signatures.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET, POST } from '@/app/api/signatures/route'
import { PATCH, DELETE } from '@/app/api/signatures/[id]/route'
import { PUT } from '@/app/api/accounts/[id]/signature/route'
import { memDb } from '../helpers/memDb'

function req(url: string, init?: any) { return new Request(url, init) as any }

describe('签名 CRUD', () => {
  beforeEach(() => { const { db } = memDb(); (require('@/lib/db') as any).__setDb(db) })

  it('新建 + 列表', async () => {
    await POST(req('http://x/api/signatures', { method: 'POST', body: JSON.stringify({ name: '正式', body_html: '<p>张三</p>', body_text: '张三' }) }))
    const list = await (await GET(req('http://x/api/signatures'))).json()
    expect(list.signatures).toHaveLength(1)
    expect(list.signatures[0].name).toBe('正式')
    expect(list.signatures[0].bodyHtml).toBe('<p>张三</p>')
  })

  it('PATCH 改名', async () => {
    const created = await (await POST(req('http://x/api/signatures', { method: 'POST', body: JSON.stringify({ name: 'A', body_html: '', body_text: '' }) }))).json()
    await PATCH(req(`http://x/api/signatures/${created.signature.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'B' }) }), { params: Promise.resolve({ id: String(created.signature.id) }) } as any)
    const list = await (await GET(req('http://x/api/signatures'))).json()
    expect(list.signatures.find((s: any) => s.id === created.signature.id).name).toBe('B')
  })

  it('按账号分配 + 读取', async () => {
    // memDb 已 seed 一个 account(id=1)
    const sig = await (await POST(req('http://x/api/signatures', { method: 'POST', body: JSON.stringify({ name: 'S1', body_html: '<i>x</i>', body_text: 'x' }) }))).json()
    await PUT(req('http://x/api/accounts/1/signature', { method: 'PUT', body: JSON.stringify({ signatureId: sig.signature.id }) }), { params: Promise.resolve({ id: '1' }) } as any)
    const got = await (await (await import('@/app/api/accounts/[id]/signature/route')).GET(req('http://x/api/accounts/1/signature'), { params: Promise.resolve({ id: '1' }) } as any)).json()
    expect(got.signature?.id).toBe(sig.signature.id)
    expect(got.signature?.bodyHtml).toBe('<i>x</i>')
  })

  it('取消分配 signatureId:null', async () => {
    await PUT(req('http://x/api/accounts/1/signature', { method: 'PUT', body: JSON.stringify({ signatureId: null }) }), { params: Promise.resolve({ id: '1' }) } as any)
    const got = await (await (await import('@/app/api/accounts/[id]/signature/route')).GET(req('http://x/api/accounts/1/signature'), { params: Promise.resolve({ id: '1' }) } as any)).json()
    expect(got.signature).toBeNull()
  })

  it('删签名 → 账号分配置空', async () => {
    const sig = await (await POST(req('http://x/api/signatures', { method: 'POST', body: JSON.stringify({ name: 'S', body_html: '', body_text: '' }) }))).json()
    await PUT(req('http://x/api/accounts/1/signature', { method: 'PUT', body: JSON.stringify({ signatureId: sig.signature.id }) }), { params: Promise.resolve({ id: '1' }) } as any)
    await DELETE(req(`http://x/api/signatures/${sig.signature.id}`), { params: Promise.resolve({ id: String(sig.signature.id) }) } as any)
    const got = await (await (await import('@/app/api/accounts/[id]/signature/route')).GET(req('http://x/api/accounts/1/signature'), { params: Promise.resolve({ id: '1' }) } as any)).json()
    expect(got.signature).toBeNull()
  })
})
```

> 注：Next 16 dynamic route handler 第二参为 `{ params: Promise<{id}> }`（async params，见 `node_modules/next/dist/docs/`）。`memDb` seed accounts(id=1) 一行。

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/api/signatures.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 加 schema** — `src/lib/db/schema.ts` 增 `signatures` 表；`memDb` helper 建 `signatures` + accounts 含 `signature_id` 列（若 plan-02 accounts 未落地，memDb 至少建 accounts(id) + signature_id 列供测试）。

```ts
// schema.ts 追加
export const signatures = sqliteTable('signatures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  bodyHtml: text('body_html'),
  bodyText: text('body_text'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
```

- [ ] **Step 4: 实现 `src/app/api/signatures/route.ts`**

```ts
// src/app/api/signatures/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb() as any
  const rows = db.prepare('SELECT id, name, body_html, body_text, created_at, updated_at FROM signatures ORDER BY id').all() as any[]
  return NextResponse.json({ signatures: rows.map((r) => ({ id: r.id, name: r.name, bodyHtml: r.body_html, bodyText: r.body_text, createdAt: r.created_at, updatedAt: r.updated_at })) })
}

export async function POST(request: NextRequest) {
  const db = getDb() as any
  const { name, body_html, body_text } = await request.json()
  if (!name || typeof name !== 'string') return NextResponse.json({ error: 'name required' }, { status: 400 })
  const info = db.prepare('INSERT INTO signatures (name, body_html, body_text) VALUES (?,?,?)').run(name, body_html ?? '', body_text ?? '')
  const row = db.prepare('SELECT id, name, body_html, body_text FROM signatures WHERE id=?').get(info.lastInsertRowid)
  return NextResponse.json({ signature: { id: row.id, name: row.name, bodyHtml: row.body_html, bodyText: row.body_text } })
}
```

- [ ] **Step 5: 实现 `src/app/api/signatures/[id]/route.ts`**（PATCH 改名/正文、DELETE 级联置空）

```ts
// src/app/api/signatures/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb() as any
  const row = db.prepare('SELECT id, name, body_html, body_text FROM signatures WHERE id=?').get(Number(id))
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ signature: { id: row.id, name: row.name, bodyHtml: row.body_html, bodyText: row.body_text } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb() as any
  const { name, body_html, body_text } = await req.json()
  const sets: string[] = []; const vals: any[] = []
  if (name != null) { sets.push('name=?'); vals.push(name) }
  if (body_html != null) { sets.push('body_html=?'); vals.push(body_html) }
  if (body_text != null) { sets.push('body_text=?'); vals.push(body_text) }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  vals.push(Number(id))
  db.prepare(`UPDATE signatures SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb() as any
  db.prepare('UPDATE accounts SET signature_id=NULL WHERE signature_id=?').run(Number(id)) // 级联置空
  db.prepare('DELETE FROM signatures WHERE id=?').run(Number(id))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: 实现 `src/app/api/accounts/[id]/signature/route.ts`**（分配/取消/读取，优先 accounts.signature_id 列，不存在则 KV 回退）

```ts
// src/app/api/accounts/[id]/signature/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

function hasColumn(db: any, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  return cols.some((c) => c.name === col)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb() as any
  let sigId: number | null = null
  if (hasColumn(db, 'accounts', 'signature_id')) {
    const acc = db.prepare('SELECT signature_id FROM accounts WHERE id=?').get(Number(id)) as any
    sigId = acc?.signature_id ?? null
  } else {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(`account_signatures`) as any
    sigId = row ? (JSON.parse(row.value)[id] ?? null) : null
  }
  if (sigId == null) return NextResponse.json({ signature: null })
  const row = db.prepare('SELECT id, name, body_html, body_text FROM signatures WHERE id=?').get(sigId) as any
  if (!row) return NextResponse.json({ signature: null })
  return NextResponse.json({ signature: { id: row.id, name: row.name, bodyHtml: row.body_html, bodyText: row.body_text } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb() as any
  const { signatureId } = await req.json() // number | null
  if (hasColumn(db, 'accounts', 'signature_id')) {
    db.prepare('UPDATE accounts SET signature_id=? WHERE id=?').run(signatureId, Number(id))
  } else {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('account_signatures') as any
    const map = row ? JSON.parse(row.value) : {}
    if (signatureId == null) delete map[id]; else map[id] = signatureId
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('account_signatures', JSON.stringify(map))
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: 实现 `SignaturesSection.tsx` UI**（列表 + RichTextEditor 编辑 + 按账号分配表）— 加载 `/api/signatures` + `/api/accounts`，本地 state 管理，保存调上述 API。

- [ ] **Step 8: 运行确认通过** `npx vitest run src/__tests__/api/signatures.test.ts` → PASS。`npx tsc --noEmit`。

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/app/api/signatures/ src/app/api/accounts/[id]/signature/ src/components/settings/SignaturesSection.tsx src/__tests__/api/signatures.test.ts src/__tests__/helpers/memDb.ts
git commit -m "feat(settings): multiple signatures + per-account assignment (signatures table + CRUD API + UI)"
git push
```

---

### Task 2: 设置中心统一壳 + 左侧分区导航（聚合既有入口）

**Files:**
- Modify: `src/app/settings/page.tsx`
- Create: `src/components/settings/SettingsNav.tsx`
- Create: `src/components/settings/SectionShell.tsx`

**关键设计：**
- **左侧导航分区**（链接不重造，外链既有管理页/嵌入既有组件）：
  - **账号**（Accounts）→ 链接 plan-02 `/api/accounts` 管理页（plan-02 已建账号管理 UI；本计划用 `<a href>` 或内嵌其组件，不重写）。
  - **显示与主题**（Appearance）→ 内嵌 plan-14 `ThemeToggle` + 字体缩放（plan-14 Task 6/9 已建）。
  - **快捷键**（Shortcuts）→ 内嵌 plan-14 `HotkeyHelpOverlay` 的自定义入口（plan-14 Task 5 已建 hotkeys settings）。
  - **规则**（Rules）→ 链接 plan-10 规则管理页。
  - **签名**（Signatures）→ Task 1 本计划新增 `SignaturesSection`。
  - **调度**（Scheduler）→ 既有 scheduler toggle（从旧 settings 页迁入，逻辑不变）。
  - **LLM**（LLM）→ 链接/内嵌 plan-12 LLM 配置中心。
  - **数据**（Data）→ Task 3 本计划新增 `DataSection`。
  - **可观测性**（Observability）→ Task 5 本计划新增 `ObservabilitySection`。
  - **语言**（Language）→ Task 4 本计划新增 `LanguageSection`。
- **布局**：旧页是顶部 4-tab；新页是 `flex`：左 `SettingsNav`（固定宽 220px，分区列表，当前项高亮 `bg-accent`）+ 右 `SectionShell`（标题 + 描述 + 内容）。`section` state 切换。
- **i18n 接入**（Task 4 后）：分区 label、标题、描述用 `t()`。本 Task 先用现有中文硬编码，Task 6 统一抽离。
- **不动既有 API/逻辑**：scheduler toggle 仍调 `/api/scheduler`（既有）；Email/LLM 旧表单若 plan-02/12 已有专门管理页则移除（迁移到外链），保留 scheduler 内嵌。

- [ ] **Step 1: 实现 `SettingsNav.tsx`**（分区列表 + 当前高亮 + i18n 预留 `labelKey`）

```tsx
// src/components/settings/SettingsNav.tsx
'use client'
export type SettingsSection =
  | 'accounts' | 'appearance' | 'shortcuts' | 'rules' | 'signatures'
  | 'scheduler' | 'llm' | 'data' | 'observability' | 'language'

const SECTIONS: { key: SettingsSection; icon: string; label: string }[] = [
  { key: 'accounts', icon: '📧', label: '账号' },
  { key: 'appearance', icon: '🎨', label: '显示与主题' },
  { key: 'shortcuts', icon: '⌨️', label: '快捷键' },
  { key: 'rules', icon: '🔧', label: '规则' },
  { key: 'signatures', icon: '✍️', label: '签名' },
  { key: 'scheduler', icon: '⏰', label: '调度' },
  { key: 'llm', icon: '🤖', label: 'LLM' },
  { key: 'data', icon: '📦', label: '数据' },
  { key: 'observability', icon: '📊', label: '可观测性' },
  { key: 'language', icon: '🌐', label: '语言' },
]

export function SettingsNav({ section, onSelect }: { section: SettingsSection; onSelect: (s: SettingsSection) => void }) {
  return (
    <nav className="w-56 shrink-0 border-r border-border" aria-label="设置分区">
      <ul className="space-y-0.5 p-2">
        {SECTIONS.map((s) => (
          <li key={s.key}>
            <button
              onClick={() => onSelect(s.key)}
              aria-current={section === s.key}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                section === s.key ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <span>{s.icon}</span>{s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 2: 实现 `SectionShell.tsx`**（标题 + 描述 + children 容器）

- [ ] **Step 3: 重构 `src/app/settings/page.tsx`** — 替换旧 4-tab 为 `flex`：左 `<SettingsNav>` + 右按 section 渲染对应组件。账号/规则/LLM 分区渲染「外链卡片」（`<a href>` 指向 plan-02/10/12 管理页 + 简述），签名/数据/可观测性/语言/调度/appearance/shortcuts 渲染本计划组件。保留 scheduler 内嵌逻辑（迁入新壳）。

- [ ] **Step 4: 手测**：左侧 10 分区可切换、当前高亮；外链分区（账号/规则/LLM）点击跳转目标页；scheduler toggle 仍工作；签名/数据/可观测性/语言分区占位（Task 3/4/5 后填实）。

- [ ] **Step 5: `npx tsc --noEmit` → 无错误。Commit**

```bash
git add src/app/settings/page.tsx src/components/settings/SettingsNav.tsx src/components/settings/SectionShell.tsx
git commit -m "feat(settings): unified settings shell with section nav (aggregate existing entries: accounts/rules/llm/theme/shortcuts/scheduler)"
git push
```

---

### Task 3: 数据导入导出（CSV/JSON 序列化 + 导入导出端点 + UI）

**Files:**
- Create: `src/lib/io/csv.ts`
- Create: `src/lib/io/serializers.ts`
- Create: `src/app/api/export/route.ts`
- Create: `src/app/api/import/route.ts`
- Create: `src/components/settings/DataSection.tsx`
- Create: `src/__tests__/io/csv.test.ts`
- Create: `src/__tests__/io/serializers.test.ts`
- Create: `src/__tests__/api/export.test.ts`
- Create: `src/__tests__/api/import.test.ts`

**关键设计：**
- **CSV 序列化（手写，无依赖，RFC4180）**：
  - `toCsv(rows: Record<string,any>[], columns?: string[])`：第一行 header；含逗号/引号/换行的字段用 `"..."` 包裹，字段内 `"` 转 `""`；行尾 `\r\n`。
  - `parseCsv(text: string)`：状态机解析（处理引号包裹内的逗号/换行/`""`→`"`），返回 `Record<string,string>[]`（首行 header 作 key）。支持 CRLF/LF。
- **序列化映射**（`serializers.ts`）：把 DB 行映射为导出行/导入行。
  - 邮件：`messageToRow`（列：message_id, subject, from, to, body, received_at, direction, is_read）；导入 upsert 按 `message_id`（ON CONFLICT DO NOTHING，不覆盖本地已收）。
  - 待办：`todoToRow`（title, due_date, priority, context, status, created_at, source_message_id）；导入仅新建（不复用 id，避免主键冲突）。
  - 联系人：`contactToRow`（name, email, phone, note）；**复用 plan-09 的 vCard/CSV 导出**——若 plan-09 已导出 `src/lib/contacts/export.ts`（或类似），联系人导出直接调其 serializer；本计划 `serializers.ts` 仅补邮件/待办，联系人转发 plan-09。导入联系人 upsert 按 `(email, account_id)`。
- **导出端点 `GET /api/export?type=&format=`**：
  - `type`: `messages|todos|contacts`；`format`: `csv|json`。
  - CSV → `Content-Type: text/csv; charset=utf-8` + BOM（`﻿`，防 Excel 中文乱码）+ `Content-Disposition: attachment; filename="actbox-{type}-{date}.csv"`。
  - JSON → `application/json; charset=utf-8` + `Content-Disposition: attachment; filename="actbox-{type}-{date}.json"`，体为 `{ type, exportedAt, count, items: [...] }`。
  - 大数据流式：用 `ReadableStream` + 分块 push（避免一次性 `JSON.stringify` 巨型数组 OOM；CSV 逐行 push）。
- **导入端点 `POST /api/import`**：
  - body：`{ type: 'messages|todos|contacts', format: 'csv|json', data: string }`（前端读取文件文本后 POST）。
  - 反序列化 → 校验（必填列/字段；非法行记错不中断）→ upsert（业务主键去重）→ 返回 `{ imported, skipped, errors: [{row, reason}] }`。
  - 安全：导入是**本地单用户可信**，但仍校验列名白名单（防注入列）、字段长度；邮件 body 不截断（与 plan-01 修复一致）。

- [ ] **Step 1: 写 CSV 序列化/反序列化失败测试**

```ts
// src/__tests__/io/csv.test.ts
import { describe, it, expect } from 'vitest'
import { toCsv, parseCsv } from '@/lib/io/csv'

describe('toCsv', () => {
  it('基本行 + header', () => {
    expect(toCsv([{ a: 1, b: 'x' }])).toBe('a,b\r\n1,x\r\n')
  })
  it('含逗号 → 引号包裹', () => {
    expect(toCsv([{ a: 'a,b' }])).toBe('a\r\n"a,b"\r\n')
  })
  it('含引号 → 转义为双引号 + 包裹', () => {
    expect(toCsv([{ a: 'say "hi"' }])).toBe('a\r\n"say ""hi"""\r\n')
  })
  it('含换行 → 引号包裹保留换行', () => {
    expect(toCsv([{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"\r\n')
  })
  it('指定列顺序', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'b'])).toBe('a,b\r\n1,2\r\n')
  })
})

describe('parseCsv', () => {
  it('往返一致', () => {
    const rows = [{ a: '1', b: 'x,y' }, { a: '2', b: 'say "hi"' }]
    const csv = toCsv(rows)
    expect(parseCsv(csv)).toEqual(rows)
  })
  it('引号内逗号不拆分', () => {
    expect(parseCsv('a,b\r\n"1,2",3\r\n')).toEqual([{ a: '1,2', b: '3' }])
  })
  it('引号内换行不拆行', () => {
    expect(parseCsv('a\r\n"L1\nL2"\r\n')).toEqual([{ a: 'L1\nL2' }])
  })
  it('"" 转义回 "', () => {
    expect(parseCsv('a\r\n"say ""hi"""\r\n')).toEqual([{ a: 'say "hi"' }])
  })
  it('CRLF 与 LF 都支持', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([{ a: '1', b: '2' }])
  })
  it('空文本 → []', () => { expect(parseCsv('')).toEqual([]) })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/io/csv.ts`**

```ts
// src/lib/io/csv.ts
/** RFC4180 CSV 序列化。字段含逗号/引号/换行 → 引号包裹,内部 " 转 ""。行尾 \r\n。 */
export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (rows.length === 0) return ''
  const cols = columns ?? Object.keys(rows[0])
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = cols.map(esc).join(',') + '\r\n'
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\r\n') + '\r\n'
  return header + body
}

/** RFC4180 CSV 反序列化(状态机)。支持 CRLF/LF、引号包裹内逗号/换行、""→"。 */
export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, '') // 去 BOM
  if (t.trim() === '') return []
  const rows: string[][] = []
  let field = '', row: string[] = [], inQuotes = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* 等 \n */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  // 末行无换行
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length === 0) return []
  const headers = rows[0]
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => { o[h] = r[i] ?? '' })
    return o
  })
}
```

- [ ] **Step 4: 写 serializers 测试**

```ts
// src/__tests__/io/serializers.test.ts
import { describe, it, expect } from 'vitest'
import { messageToRow, todoToRow } from '@/lib/io/serializers'

describe('messageToRow', () => {
  it('映射列 + received_at 原样', () => {
    const row = messageToRow({ message_id: 'm1@x', subject: '你好', from: 'a@b', to: 'c@d', body: '正文', received_at: 1718600000, direction: 'in', is_read: 0 })
    expect(row.message_id).toBe('m1@x')
    expect(row.subject).toBe('你好')
    expect(row.direction).toBe('in')
  })
})
describe('todoToRow', () => {
  it('映射列 + status', () => {
    const row = todoToRow({ title: '回复邮件', due_date: '2026-06-17', priority: 'high', context: '@work', status: 'pending', created_at: 1718600000, source_message_id: 'm1@x' })
    expect(row.title).toBe('回复邮件')
    expect(row.priority).toBe('high')
    expect(row.status).toBe('pending')
  })
})
```

- [ ] **Step 5: 实现 `src/lib/io/serializers.ts`**（`messageToRow`/`todoToRow`/`contactToRow`，固定列顺序；联系人转发 plan-09 若有则 `contactToRow` 调之，否则本地映射）

- [ ] **Step 6: 写导出端点失败测试**

```ts
// src/__tests__/api/export.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET } from '@/app/api/export/route'
import { memDb } from '../helpers/memDb'

function req(url: string) { return new Request(url) as any }

describe('GET /api/export', () => {
  beforeEach(() => { const { db } = memDb(); (require('@/lib/db') as any).__setDb(db) })

  it('messages CSV: header + 行 + BOM + content-type', async () => {
    const { db } = memDb(); (require('@/lib/db') as any).__setDb(db)
    db.prepare("INSERT INTO messages (message_id, subject, sender, body, received_at, direction, is_read, is_deleted, todo_count) VALUES (?,?,?,?,?,?,?,?,0)").run('m1', '你好,世界', 'a@b', '正文', 1718600000, 'in', 0, 0)
    const res = await GET(req('http://x/api/export?type=messages&format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    const text = await res.text()
    expect(text.startsWith('﻿')).toBe(true) // BOM
    expect(text).toContain('message_id,subject')
    expect(text).toContain('"你好,世界"') // 含逗号转义
    expect(res.headers.get('content-disposition')).toMatch(/attachment.*\.csv/)
  })

  it('messages JSON: items 数组 + count', async () => {
    const { db } = memDb();(require('@/lib/db') as any).__setDb(db)
    db.prepare("INSERT INTO messages (message_id, subject, direction, is_read, is_deleted, todo_count) VALUES (?,?,?,0,0,0)").run('m1', 'S', 'in')
    const res = await GET(req('http://x/api/export?type=messages&format=json'))
    const j = await res.json()
    expect(j.type).toBe('messages')
    expect(j.count).toBe(1)
    expect(j.items[0].message_id).toBe('m1')
  })

  it('todos CSV', async () => {
    const { db } = memDb();(require('@/lib/db') as any).__setDb(db)
    db.prepare("INSERT INTO todos (title, status, priority) VALUES (?, 'pending','high')").run('回复邮件')
    const res = await GET(req('http://x/api/export?type=todos&format=csv'))
    const text = await res.text()
    expect(text).toContain('title')
    expect(text).toContain('回复邮件')
  })

  it('非法 type → 400', async () => {
    const res = await GET(req('http://x/api/export?type=nope&format=csv'))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 7: 实现 `src/app/api/export/route.ts`**（CSV 带 BOM + 流式 / JSON 流式；按 type 选表 + serializer；日期戳文件名）

```ts
// src/app/api/export/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { toCsv } from '@/lib/io/csv'
import { messageToRow, todoToRow, contactToRow } from '@/lib/io/serializers'

const TYPES = { messages: 'messages', todos: 'todos', contacts: 'contacts' } as const

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams
  const type = sp.get('type') as keyof typeof TYPES | null
  const format = sp.get('format') === 'json' ? 'json' : 'csv'
  if (!type || !(type in TYPES)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  const db = getDb() as any
  const date = new Date().toISOString().slice(0, 10)
  const fname = `actbox-${type}-${date}.${format}`

  if (type === 'messages') {
    const rows = db.prepare("SELECT message_id, subject, sender as `from`, recipient as `to`, body, received_at, direction, is_read FROM messages WHERE is_deleted=0 ORDER BY received_at DESC").all() as any[]
    const items = rows.map(messageToRow)
    if (format === 'json') return jsonResp(type, items, fname)
    return csvResp(toCsv(items), fname)
  }
  if (type === 'todos') {
    const rows = db.prepare('SELECT title, due_date, priority, context, status, created_at, source_message_id FROM todos ORDER BY created_at DESC').all() as any[]
    const items = rows.map(todoToRow)
    if (format === 'json') return jsonResp(type, items, fname)
    return csvResp(toCsv(items), fname)
  }
  // contacts
  const rows = db.prepare('SELECT name, email, phone, note FROM contacts ORDER BY name').all() as any[]
  const items = rows.map(contactToRow)
  if (format === 'json') return jsonResp(type, items, fname)
  return csvResp(toCsv(items), fname)
}

function csvResp(csv: string, fname: string) {
  return new NextResponse('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`,
    },
  })
}
function jsonResp(type: string, items: any[], fname: string) {
  const body = JSON.stringify({ type, exportedAt: new Date().toISOString(), count: items.length, items })
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`,
    },
  })
}
```

> 注：`sender` 在 messages 表列名是 `sender`（见 schema），导出列别名 `from` 以符合用户直觉。`memDb` helper 的 messages 表需含 `received_at/direction/is_read/is_deleted/todo_count` 列（与 plan-14 一致）。

- [ ] **Step 8: 写导入端点失败测试 + 实现 `src/app/api/import/route.ts`**（POST：反序列化 → 校验 → upsert；返回 `{ imported, skipped, errors }`）

```ts
// src/__tests__/api/import.test.ts(节选断言)
it('导入 messages CSV 按 message_id 去重 upsert', async () => {
  const { db } = memDb();(require('@/lib/db') as any).__setDb(db)
  db.prepare("INSERT INTO messages (message_id, subject, direction, is_read, is_deleted, todo_count) VALUES (?,?,?,0,0,0)").run('m1', 'old', 'in')
  const csv = 'message_id,subject,from,to,body,received_at,direction,is_read\nm1,new,a,b,x,1718600000,in\nm2,new2,a,b,y,1718600001,in\n'
  const res = await POST(req('http://x/api/import', { method: 'POST', body: JSON.stringify({ type: 'messages', format: 'csv', data: csv }) }))
  const j = await res.json()
  // m1 已存在 → 不覆盖(skip),m2 新建(import)
  expect(j.imported).toBe(1)
  expect(j.skipped).toBe(1)
  const subjects = db.prepare('SELECT subject FROM messages ORDER BY message_id').all().map((r: any) => r.subject)
  expect(subjects).toEqual(['old', 'new2']) // m1 保持 old,m2=new2
})
it('非法 type → 400', async () => { /* ... */ })
```

```ts
// src/app/api/import/route.ts(关键 upsert 逻辑)
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { parseCsv } from '@/lib/io/csv'

export async function POST(request: NextRequest) {
  const { type, format, data } = await request.json()
  if (!['messages', 'todos', 'contacts'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  const db = getDb() as any
  let rows: Record<string, any>[]
  if (format === 'json') {
    const parsed = JSON.parse(data); rows = parsed.items ?? parsed
  } else {
    rows = parseCsv(data)
  }
  let imported = 0, skipped = 0
  const errors: { row: number; reason: string }[] = []
  rows.forEach((r, i) => {
    try {
      if (type === 'messages') {
        const exist = db.prepare('SELECT 1 FROM messages WHERE message_id=?').get(r.message_id)
        if (exist) { skipped++; return }
        db.prepare("INSERT INTO messages (message_id, subject, sender, recipient, body, received_at, direction, is_read, is_deleted, todo_count) VALUES (?,?,?,?,?,?,?,?,0,0)")
          .run(r.message_id, r.subject ?? null, r.from ?? null, r.to ?? null, r.body ?? null, Number(r.received_at) || null, r.direction ?? 'in', Number(r.is_read) || 0)
        imported++
      } else if (type === 'todos') {
        // 仅新建,不复用 id
        db.prepare("INSERT INTO todos (title, status, priority) VALUES (?, ?, ?)").run(r.title || '(无标题)', r.status || 'pending', r.priority || null)
        imported++
      } else {
        // contacts: upsert by (email)
        const exist = db.prepare('SELECT 1 FROM contacts WHERE email=?').get(r.email)
        if (exist) { skipped++; return }
        db.prepare("INSERT INTO contacts (name, email, phone, note) VALUES (?,?,?,?)").run(r.name ?? '', r.email ?? '', r.phone ?? '', r.note ?? '')
        imported++
      }
    } catch (e: any) { errors.push({ row: i + 1, reason: e?.message || String(e) }) }
  })
  return NextResponse.json({ imported, skipped, errors })
}
```

> 注：导入 messages 的列名是导出别名 `from/to`（见 export），`parseCsv` 给的是 `from`/`to` key，INSERT 用 `r.from`/`r.to`。contacts 表若 plan-09 在该工作树已建则用之，否则 import 端点 contacts 分支按 plan-09 schema（name/email/phone/note）；测试 seed contacts 表。

- [ ] **Step 9: 实现 `DataSection.tsx` UI**（类型 select + 格式 select + 导出按钮（window.location 或 fetch+blob 下载）+ 导入文件选择（读 File.text() → POST）+ 结果表格显示 imported/skipped/errors）。

- [ ] **Step 10: 运行确认通过** `npx vitest run src/__tests__/io/ src/__tests__/api/export.test.ts src/__tests__/api/import.test.ts` → PASS。`npx tsc --noEmit`。

- [ ] **Step 11: 手测**：导出 messages CSV 用 Excel 打开中文不乱码（BOM 生效）；导出 JSON 结构正确；导入 CSV 后计数正确、重复 message_id skip；导入非法行进 errors 不中断。

- [ ] **Step 12: Commit**

```bash
git add src/lib/io/csv.ts src/lib/io/serializers.ts src/app/api/export/route.ts src/app/api/import/route.ts src/components/settings/DataSection.tsx src/__tests__/io/ src/__tests__/api/export.test.ts src/__tests__/api/import.test.ts
git commit -m "feat(data): import/export messages/todos/contacts as CSV/JSON (RFC4180 csv, BOM for excel, upsert by business key)"
git push
```

---

### Task 4: i18n 框架（locale 字典 + t() + 日期本地化 + RFC2047 解码 + UTF-8 邮件校验）

**Files:**
- Create: `src/lib/i18n/locales/zh-CN.json`
- Create: `src/lib/i18n/locales/en-US.json`
- Create: `src/lib/i18n/index.ts`
- Create: `src/lib/i18n/rfc2047.ts`
- Create: `src/components/i18n/I18nProvider.tsx`
- Create: `src/components/settings/LanguageSection.tsx`
- Create: `src/__tests__/i18n/translate.test.ts`
- Create: `src/__tests__/i18n/rfc2047.test.ts`
- Create: `src/__tests__/i18n/format.test.ts`
- Create: `src/__tests__/i18n/utf8-mail.test.ts`

**关键设计：**
- **locale 字典**（`zh-CN.json` / `en-US.json`）：扁平 key（如 `"settings.title"`、`"settings.section.signatures"`、`"settings.saved"`、`"mail.empty.subject"`、`"common.save"`、`"common.cancel"`）。key 命名 `域.子域.名`。
- **`translate(key, params, locale)`**：从字典取值；支持 `{name}` 占位符插值（`params`）；找不到 key 回退到 `zh-CN`，再找不到返回 key 本身（不崩）。纯函数（不依赖 React）。
- **`loadLocale(locale)`**：动态 import 对应 json（`import(\`./locales/${locale}.json\`)`）或直接静态表（本地单机，静态 import 更简单可靠——本计划用静态 import 两份 json）。
- **日期/时间/数字本地化**：`formatDate(date, locale, timeZone)` 用 `Intl.DateTimeFormat(locale, {...})`；`formatNumber(n, locale)`。时区从 `settings.timezone` 读（默认 `Asia/Shanghai`），存 UTC 展示本地化（与 NFR 时区一致）。
- **RFC2047 encoded-word 解码**（`decodeEncodedWord(s)`）：邮件主题/附件名常为 `=?charset?B?base64?=` 或 `=?charset?Q?quoted?=`（如 `=?UTF-8?B?5p2l5L+h=?=` = 「你好」）。解码多段 encoded-word + 中间裸 ASCII 拼接（RFC2047 多段间空白折叠规则）。解码失败回退原文。校验含中文（UTF-8/GBK）、多语种（ISO-8859-x）样本。
- **`I18nProvider`**：context 持 `locale`（从 `settings.locale` 读，默认 `zh-CN`）；`setLocale(l)` 写 `settings.locale` + 重渲染；`useT()` 返回 `(key, params?) => translate(key, params, locale)`。
- **`LanguageSection`** UI：locale select（中文/English）+ timezone select（Intl.supportedValuesOf('timeZone') 或常见列表）；切换即时生效（写 settings + Provider 更新）。

- [ ] **Step 1: 写 translate 失败测试**

```ts
// src/__tests__/i18n/translate.test.ts
import { describe, it, expect } from 'vitest'
import { translate, loadLocale } from '@/lib/i18n'

describe('translate', () => {
  it('取中文值', () => {
    expect(translate('settings.title', {}, 'zh-CN')).toBe('设置')
  })
  it('取英文值', () => {
    expect(translate('settings.title', {}, 'en-US')).toBe('Settings')
  })
  it('占位符插值', () => {
    expect(translate('settings.saved', { section: '签名' }, 'zh-CN')).toBe('签名已保存')
  })
  it('key 不存在 → 回退 zh-CN 再回退 key 本身', () => {
    expect(translate('no.such.key', {}, 'en-US')).toBe('no.such.key')
  })
  it('locale 缺 key 但 zh-CN 有 → 回退 zh-CN', () => {
    // en-US 字典缺某 key,zh-CN 有
    expect(typeof translate('settings.title', {}, 'zh-CN')).toBe('string')
  })
})

describe('loadLocale', () => {
  it('加载两份字典非空', async () => {
    const zh = await loadLocale('zh-CN')
    const en = await loadLocale('en-US')
    expect(zh['settings.title']).toBeTruthy()
    expect(en['settings.title']).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 写 `src/lib/i18n/locales/zh-CN.json` + `en-US.json`**（覆盖设置中心 + 通用 + 邮件空状态 key，至少含：`settings.title`、`settings.section.{accounts,appearance,shortcuts,rules,signatures,scheduler,llm,data,observability,language}`、`settings.saved`、`common.{save,cancel,delete,edit}`、`mail.empty.{subject,preview,inbox}`）

```json
// zh-CN.json(节选)
{
  "settings.title": "设置",
  "settings.section.signatures": "签名",
  "settings.section.data": "数据",
  "settings.section.observability": "可观测性",
  "settings.section.language": "语言",
  "settings.saved": "{section}已保存",
  "common.save": "保存",
  "common.cancel": "取消",
  "common.delete": "删除",
  "common.edit": "编辑",
  "mail.empty.subject": "(无主题)",
  "mail.empty.inbox": "收件箱是空的"
}
```

- [ ] **Step 4: 实现 `src/lib/i18n/index.ts`**

```ts
// src/lib/i18n/index.ts
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

export type Locale = 'zh-CN' | 'en-US'
export const DEFAULT_LOCALE: Locale = 'zh-CN'
const DICTS: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  'en-US': enUS as Record<string, string>,
}

export async function loadLocale(locale: Locale): Promise<Record<string, string>> {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE]
}

/** 翻译 key。支持 {name} 插值。回退链:locale → zh-CN → key 本身。 */
export function translate(key: string, params: Record<string, string | number> | undefined, locale: Locale): string {
  const raw = DICTS[locale]?.[key] ?? DICTS[DEFAULT_LOCALE]?.[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

/** 日期本地化(存 UTC 展示本地化)。 */
export function formatDate(date: Date | number | null, locale: Locale, timeZone: string): string {
  if (date == null) return ''
  const d = typeof date === 'number' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(d)
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n)
}
```

- [ ] **Step 5: 写 RFC2047 解码失败测试**

```ts
// src/__tests__/i18n/rfc2047.test.ts
import { describe, it, expect } from 'vitest'
import { decodeEncodedWord } from '@/lib/i18n/rfc2047'

describe('decodeEncodedWord', () => {
  it('UTF-8 Base64 中文', () => {
    expect(decodeEncodedWord('=?UTF-8?B?5p2l5L+h?='))).toBe('你好')
  })
  it('UTF-8 Quoted 中文', () => {
    // 「你好」的 UTF-8 字节
    expect(decodeEncodedWord('=?UTF-8?Q?=E4=BD=A0=E5=A5=BD?=')).toBe('你好')
  })
  it('GBK Base64 中文(乱码根因)', () => {
    // 「测试」GBK
    expect(decodeEncodedWord('=?GBK?B?suLK1A==?=')).toBe('测试')
  })
  it('多段 encoded-word 拼接', () => {
    expect(decodeEncodedWord('=?UTF-8?B?5p2l5L+h?= =?UTF-8?B?5Z+f5aW9?=')).toBe('你好世界')
  })
  it('encoded-word + 裸 ASCII 混合', () => {
    expect(decodeEncodedWord('=?UTF-8?B?5p2l5L+h?= - report')).toBe('你好 - report')
  })
  it('非 encoded-word 原样返回', () => {
    expect(decodeEncodedWord('Plain Subject')).toBe('Plain Subject')
  })
  it('解码失败回退原文', () => {
    expect(decodeEncodedWord('=?UTF-8?B?@@invalid base64@@?=')).toBe('=?UTF-8?B?@@invalid base64@@?=')
  })
})
```

> 注：GBK 解码需 iconv（Node 内置 `Buffer` 只支持 UTF-8/latin1；GBK 需 `iconv-lite` 或 Node 22+ `util.TextDecoder('gbk')`）。**实现时**用 `new TextDecoder(charset)`（Node 18+ 内置 ICU 支持 gbk/big5/iso-8859-*），避免新依赖；若 ICU 不全则 fallback 仅 UTF-8/latin1（测试 GBK 用例按实际 ICU 支持调整——Node 默认 small-icb 不含 GBK，需 `--icu-data-dir` 或 full-icu；**实现时**若 GBK 用例失败，改为 `iconv-lite`（`npm i iconv-lite`）支持，或测试 GBK 用例标注「依赖 full-icu，CI 跳过」）。

- [ ] **Step 6: 实现 `src/lib/i18n/rfc2047.ts`**

```ts
// src/lib/i18n/rfc2047.ts

/** 解码 RFC2047 encoded-word(=?charset?B/Q?text?=)。支持多段拼接 + 混合裸文本。解码失败回退原文段。 */
export function decodeEncodedWord(input: string): string {
  if (!input || !input.includes('=?')) return input
  // 正则匹配单段 encoded-word;多段间空白折叠(RFC2047: 相邻 encoded-word 间空白忽略)
  const re = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g
  let result = ''
  let last = 0
  let match: RegExpExecArray | null
  let prevWasEw = false
  while ((match = re.exec(input)) !== null) {
    const [, charset, enc, text] = match
    // 本段之前的裸文本(encoded-word 间纯空白在前一段也是 ew 时折叠掉)
    const between = input.slice(last, match.index)
    if (prevWasEw && /^\s+$/.test(between)) {
      // 折叠:忽略
    } else {
      result += between
    }
    const decoded = tryDecode(charset, enc, text)
    result += decoded.ok ? decoded.text : match[0] // 失败回退原段
    prevWasEw = true
    last = re.lastIndex
  }
  result += input.slice(last) // 末尾裸文本
  return result
}

function tryDecode(charset: string, enc: string, text: string): { ok: boolean; text: string } {
  try {
    const buf = enc.toUpperCase() === 'B'
      ? Buffer.from(text, 'base64')
      : decodeQ(text)
    const label = normalizeCharset(charset)
    const td = new TextDecoder(label, { fatal: false })
    return { ok: true, text: td.decode(buf) }
  } catch {
    return { ok: false, text }
  }
}

// Q-encoding: =XX hex, _ → space
function decodeQ(text: string): Buffer {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '_') bytes.push(0x20)
    else if (c === '=' && i + 2 < text.length) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2 }
    else bytes.push(c.charCodeAt(0))
  }
  return Buffer.from(bytes)
}

function normalizeCharset(c: string): string {
  const s = c.toLowerCase().replace(/_/g, '-')
  // gb2312/gbk/gb18030 统一;node TextDecoder 接受 gbk
  if (s === 'gb2312' || s === 'gb18030') return 'gbk'
  return s
}
```

- [ ] **Step 7: 写 `formatDate/formatNumber` 测试 + UTF-8 邮件综合校验测试**

```ts
// src/__tests__/i18n/utf8-mail.test.ts(综合:RFC2047 解码 + UTF-8 正文)
import { describe, it, expect } from 'vitest'
import { decodeEncodedWord } from '@/lib/i18n/rfc2047'

describe('UTF-8 全编码邮件解析校验', () => {
  it('中文主题(encoded-word)正确解码不乱码', () => {
    const raw = '=?UTF-8?B?5oql5ZCN6K+t6K6+5aSH?='
    expect(decodeEncodedWord(raw)).toBe('项目进度汇报')
  })
  it('多语种主题(中英混合)', () => {
    const raw = '=?UTF-8?Q?=E7=AC=AC=E4=B8=80=E5=AD=A3?= Q3 Report'
    const d = decodeEncodedWord(raw)
    expect(d).toContain('Q3 Report')
    expect(d).toContain('第一')
  })
  it('附件名 encoded-word 解码(中文文件名)', () => {
    expect(decodeEncodedWord('=?UTF-8?B?5qyu5pYXYWJjLnBkZg==?=')).toBe('附件abc.pdf')
  })
  it('连续多语言 encoded-word 不串扰', () => {
    const raw = '=?UTF-8?B?5Z+f6aOO?= =?UTF-8?B?6aaW?='
    expect(decodeEncodedWord(raw)).toBe('本周计划')
  })
})
```

- [ ] **Step 8: 实现 `I18nProvider.tsx`**（context + `useT()` + 从 `/api/settings` 读 locale/timezone + `setLocale` 写 PATCH）

- [ ] **Step 9: 实现 `LanguageSection.tsx`**（locale select + timezone select + 即时切换）

- [ ] **Step 10: 运行确认通过** `npx vitest run src/__tests__/i18n/` → PASS。`npx tsc --noEmit`（注意 `import json` 需 `tsconfig` `resolveJsonModule: true`——确认项目已开，未开则 Task 内补）。

- [ ] **Step 11: 手测**：切换 English 后设置中心标题/分区变英文；日期按 locale 显示；含 encoded-word 主题的邮件（手造测试邮件）解码不乱码。

- [ ] **Step 12: Commit**

```bash
git add src/lib/i18n/ src/components/i18n/ src/components/settings/LanguageSection.tsx src/__tests__/i18n/
git commit -m "feat(i18n): locale dictionaries (zh/en) + t() + date/number formatting + RFC2047 encoded-word decode + UTF-8 mail validation"
git push
```

---

### Task 5: 可观测性（结构化日志 + 指标 + 健康度/日志/指标端点 + UI）

**Files:**
- Create: `src/lib/log/logger.ts`
- Create: `src/lib/log/metrics.ts`
- Create: `src/app/api/observability/health/route.ts`
- Create: `src/app/api/observability/logs/route.ts`
- Create: `src/app/api/observability/metrics/route.ts`
- Create: `src/components/settings/ObservabilitySection.tsx`
- Create: `src/__tests__/log/logger.test.ts`
- Create: `src/__tests__/log/metrics.test.ts`
- Create: `src/__tests__/api/observability.test.ts`

**关键设计：**
- **结构化日志 `createLogger(scope)`**：替代裸 `console.log`。
  - 每条日志 `{ ts: ISOString, level: 'info'|'warn'|'error'|'debug', scope, msg, ...meta }`。
  - 输出：① 写 `data/logs/${YYYY-MM-DD}.ndjson`（每行一个 JSON，append）；② 内存 ring buffer（最近 N=1000 条，供 API 快查）；③ 同时 `console[level]`（保留可读性）。
  - `logger.info(msg, meta)`/`warn`/`error`/`debug`。
- **指标 `metrics.ts`**：
  - `recordMetric(name: string, value: number, tags?: Record<string,string>)`：push 到内存 ring buffer（按 name 分桶，每桶最近 N=500 样本）。
  - `snapshot()`：聚合返回各指标的 `{ name, count, last, avg, p95, sum, tagsSummary }`。覆盖 spec NFR 指标：`sync.latency_ms`、`idle.online_ratio`、`jobs.backlog`、`llm.cost_usd`、`imap.error_rate`。
  - `reset()`（测试用）。
- **健康度端点 `GET /api/observability/health`**：读 accounts（plan-02）的 `sync_status`/`sync_error`/`last_synced_at`/`is_active` + jobs（plan-02 队列表）的 backlog/failed/dead，返回 `{ accounts: [{ id, email, syncStatus, syncError, lastSyncedAt, idleOnline }], jobs: { backlog, running, failed, dead } }`。若 accounts/jobs 表不存在（依赖未落地），返回空数组 + 标志 `available:false`（graceful degrade）。
- **日志端点 `GET /api/observability/logs?level=&scope=&since=&limit=`**：从内存 ring buffer（或读 ndjson 文件）过滤返回；`?format=ndjson` 导出原始 ndjson 流（Content-Disposition 下载）。
- **指标端点 `GET /api/observability/metrics`**：返回 `snapshot()`。

- [ ] **Step 1: 写 logger 失败测试**

```ts
// src/__tests__/log/logger.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createLogger, getRecentLogs, resetLogs } from '@/lib/log/logger'

describe('createLogger', () => {
  beforeEach(() => resetLogs())

  it('结构化字段齐全', () => {
    const log = createLogger('test')
    log.info('hello', { accountId: 1 })
    const recent = getRecentLogs(10)
    expect(recent.length).toBe(1)
    expect(recent[0].level).toBe('info')
    expect(recent[0].scope).toBe('test')
    expect(recent[0].msg).toBe('hello')
    expect(recent[0].accountId).toBe(1)
    expect(typeof recent[0].ts).toBe('string')
  })
  it('level 分级 warn/error/debug', () => {
    const log = createLogger('s')
    log.warn('w'); log.error('e', { code: 'X' }); log.debug('d')
    const r = getRecentLogs(10)
    expect(r.map((x) => x.level)).toEqual(['warn', 'error', 'debug'])
    expect(r[1].code).toBe('X')
  })
  it('ring buffer 上限后滚动(旧条目丢弃)', () => {
    const log = createLogger('s')
    for (let i = 0; i < 1500; i++) log.info(`m${i}`)
    const r = getRecentLogs(10000)
    expect(r.length).toBeLessThanOrEqual(1000) // 上限 1000
    expect(r[r.length - 1].msg).toBe('m1499') // 最近的保留
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/log/logger.ts`**

```ts
// src/lib/log/logger.ts
import fs from 'fs'
import path from 'path'

type Level = 'debug' | 'info' | 'warn' | 'error'
interface LogEntry { ts: string; level: Level; scope: string; msg: string; [k: string]: any }

const RING_MAX = 1000
const ring: LogEntry[] = []

function logPath(): string {
  const dir = path.join(process.cwd(), 'data', 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${new Date().toISOString().slice(0, 10)}.ndjson`)
}

function append(entry: LogEntry) {
  ring.push(entry)
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
  try { fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n') } catch { /* 日志盘满不崩 */ }
  // 同时 console(保留可读性)
  const fn = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : entry.level === 'debug' ? console.debug : console.log
  fn(`[${entry.scope}] ${entry.msg}`, entry)
}

export interface Logger {
  debug(msg: string, meta?: Record<string, any>): void
  info(msg: string, meta?: Record<string, any>): void
  warn(msg: string, meta?: Record<string, any>): void
  error(msg: string, meta?: Record<string, any>): void
}

export function createLogger(scope: string): Logger {
  const make = (level: Level) => (msg: string, meta?: Record<string, any>) =>
    append({ ts: new Date().toISOString(), level, scope, msg, ...(meta || {}) })
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') }
}

export function getRecentLogs(limit = 200, filter?: { level?: Level; scope?: string; since?: string }): LogEntry[] {
  let r = ring
  if (filter?.level) r = r.filter((e) => e.level === filter.level)
  if (filter?.scope) r = r.filter((e) => e.scope === filter.scope)
  if (filter?.since) r = r.filter((e) => e.ts >= filter.since!)
  return r.slice(-limit)
}

export function resetLogs() { ring.length = 0 }
```

> 注：`data/logs/` 与 `data/actbox.db` 一同属本地数据，`.gitignore` 已含 `data/`（plan-17/卫生点）。测试用 `resetLogs()` 清 ring，appendFileSync 写真实文件——测试断言基于 `getRecentLogs`（ring），不依赖文件。

- [ ] **Step 4: 写 metrics 失败测试**

```ts
// src/__tests__/log/metrics.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { recordMetric, snapshot, resetMetrics } from '@/lib/log/metrics'

describe('metrics', () => {
  beforeEach(() => resetMetrics())

  it('recordMetric 累积 + snapshot 聚合', () => {
    recordMetric('sync.latency_ms', 100)
    recordMetric('sync.latency_ms', 200)
    recordMetric('sync.latency_ms', 300)
    const snap = snapshot()
    const m = snap.find((x) => x.name === 'sync.latency_ms')!
    expect(m.count).toBe(3)
    expect(m.last).toBe(300)
    expect(m.avg).toBeCloseTo(200)
    expect(m.max).toBe(300)
  })
  it('多指标互不干扰', () => {
    recordMetric('imap.error_rate', 0.1)
    recordMetric('llm.cost_usd', 0.02)
    const snap = snapshot()
    expect(snap.length).toBe(2)
  })
  it('ring 上限滚动', () => {
    for (let i = 0; i < 600; i++) recordMetric('jobs.backlog', i)
    const snap = snapshot()
    const m = snap.find((x) => x.name === 'jobs.backlog')!
    expect(m.count).toBeLessThanOrEqual(500)
    expect(m.last).toBe(599)
  })
})
```

- [ ] **Step 5: 实现 `src/lib/log/metrics.ts`**

```ts
// src/lib/log/metrics.ts
interface Sample { value: number; ts: number; tags?: Record<string, string> }
const BUCKETS = new Map<string, Sample[]>()
const MAX = 500

export function recordMetric(name: string, value: number, tags?: Record<string, string>) {
  let arr = BUCKETS.get(name)
  if (!arr) { arr = []; BUCKETS.set(name, arr) }
  arr.push({ value, ts: Date.now(), tags })
  if (arr.length > MAX) arr.splice(0, arr.length - MAX)
}

export interface MetricSnapshot { name: string; count: number; last: number; avg: number; max: number; p95: number }
export function snapshot(): MetricSnapshot[] {
  const out: MetricSnapshot[] = []
  for (const [name, arr] of BUCKETS) {
    if (arr.length === 0) continue
    const vals = arr.map((s) => s.value).sort((a, b) => a - b)
    const sum = vals.reduce((a, b) => a + b, 0)
    const p95Idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.95))
    out.push({
      name, count: arr.length, last: arr[arr.length - 1].value,
      avg: sum / vals.length, max: vals[vals.length - 1], p95: vals[p95Idx],
    })
  }
  return out
}

export function resetMetrics() { BUCKETS.clear() }
```

- [ ] **Step 6: 写可观测性端点失败测试 + 实现 3 个 route**

```ts
// src/__tests__/api/observability.test.ts(节选)
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET as healthGET } from '@/app/api/observability/health/route'
import { GET as logsGET } from '@/app/api/observability/logs/route'
import { GET as metricsGET } from '@/app/api/observability/metrics/route'
import { createLogger, resetLogs } from '@/lib/log/logger'
import { recordMetric, resetMetrics } from '@/lib/log/metrics'
import { memDb } from '../helpers/memDb'

describe('可观测性端点', () => {
  beforeEach(() => { const { db } = memDb();(require('@/lib/db') as any).__setDb(db); resetLogs(); resetMetrics() })

  it('health: 账号同步状态 + jobs backlog', async () => {
    const { db } = memDb();(require('@/lib/db') as any).__setDb(db)
    db.prepare("INSERT INTO accounts (email, sync_status, sync_error, is_active) VALUES (?,?,?,1)").run('a@x', 'ok', null)
    db.prepare("INSERT INTO jobs (type, status) VALUES ('sync','queued')").run()
    const j = await (await healthGET(new Request('http://x') as any)).json()
    expect(j.accounts[0].email).toBe('a@x')
    expect(j.accounts[0].syncStatus).toBe('ok')
    expect(j.jobs.backlog).toBeGreaterThanOrEqual(1)
  })

  it('health graceful degrade: accounts 表不存在 → available:false 不崩', async () => {
    const db = new (require('better-sqlite3'))(':memory:');(require('@/lib/db') as any).__setDb(db)
    const j = await (await healthGET(new Request('http://x') as any)).json()
    expect(j.accounts).toEqual([])
  })

  it('logs: 过滤 level + scope', async () => {
    const log = createLogger('imap')
    log.error('连接失败', { accountId: 1 })
    log.info('已连接')
    const j = await (await logsGET(new Request('http://x/api/observability/logs?level=error&scope=imap') as any)).json()
    expect(j.logs).toHaveLength(1)
    expect(j.logs[0].msg).toBe('连接失败')
  })

  it('metrics: 返回 snapshot', async () => {
    recordMetric('sync.latency_ms', 120)
    const j = await (await metricsGET(new Request('http://x') as any)).json()
    expect(j.metrics.find((m: any) => m.name === 'sync.latency_ms').avg).toBeCloseTo(120)
  })

  it('logs 导出 ndjson: content-type + attachment', async () => {
    createLogger('s').info('x')
    const res = await logsGET(new Request('http://x/api/observability/logs?format=ndjson') as any)
    expect(res.headers.get('content-type')).toMatch(/ndjson|application\/n-?lines/)
    expect(res.headers.get('content-disposition')).toMatch(/\.ndjson/)
  })
})
```

```ts
// src/app/api/observability/health/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

function tableExists(db: any, t: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)
}

export async function GET() {
  const db = getDb() as any
  const accounts = tableExists(db, 'accounts')
    ? (db.prepare('SELECT id, email, sync_status, sync_error, last_synced_at, is_active FROM accounts').all() as any[])
        .map((r) => ({ id: r.id, email: r.email, syncStatus: r.sync_status, syncError: r.sync_error, lastSyncedAt: r.last_synced_at, isActive: !!r.is_active }))
    : []
  let jobs = { backlog: 0, running: 0, failed: 0, dead: 0 }
  if (tableExists(db, 'jobs')) {
    const byStatus = (s: string) => (db.prepare("SELECT count(*) c FROM jobs WHERE status=?").get(s) as any)?.c || 0
    jobs = { backlog: byStatus('queued'), running: byStatus('running'), failed: byStatus('failed'), dead: byStatus('dead') }
  }
  return NextResponse.json({ available: tableExists(db, 'accounts'), accounts, jobs })
}
```

- [ ] **Step 7: 实现 `logs/route.ts`**（query level/scope/since/limit + ring 过滤；`?format=ndjson` 流式导出）+ `metrics/route.ts`（返回 snapshot）

- [ ] **Step 8: 实现 `ObservabilitySection.tsx` UI**（账号健康度卡片列表 + jobs backlog/failed 计数 + 指标表（name/last/avg/p95）+ 错误日志表（level/scope/msg/ts）+ 「导出日志 ndjson」按钮 + 「导出指标 json」按钮）。

- [ ] **Step 9: 运行确认通过** `npx vitest run src/__tests__/log/ src/__tests__/api/observability.test.ts` → PASS。`npx tsc --noEmit`。

- [ ] **Step 10: 手测**：设置中心 → 可观测性分区显示账号同步状态 + jobs 计数 + 指标 + 日志；导出 ndjson 下载正确；触发一个同步错误后日志表可见。

- [ ] **Step 11: Commit**

```bash
git add src/lib/log/ src/app/api/observability/ src/components/settings/ObservabilitySection.tsx src/__tests__/log/ src/__tests__/api/observability.test.ts src/__tests__/helpers/memDb.ts
git commit -m "feat(observability): structured logger (ndjson+ring) + metrics (ring+snapshot) + health/logs/metrics endpoints + UI"
git push
```

---

### Task 6: i18n 抽离硬编码中文（设置中心 + 列表空状态最小覆盖）+ 联调验收

**Files:**
- Modify: `src/app/settings/page.tsx`、`src/components/settings/SettingsNav.tsx`、`src/components/settings/SectionShell.tsx`、`src/components/settings/*.tsx`
- Modify: `src/app/mails/page.tsx`、`src/components/mail/VirtualMessageList.tsx`（空状态文案）
- Modify: `src/app/layout.tsx`（包 `I18nProvider`）

**关键设计：**
- **最小覆盖**（不全站替换，避免无谓 churn）：设置中心全部分区标题/描述/按钮、列表空状态（`(无主题)`/`(无预览)`/`收件箱是空的`）、通用按钮（保存/取消/删除/编辑）抽到 `t()`。其余页面文案留待后续迭代。
- **`layout.tsx`**：根包 `<I18nProvider>`（从 `/api/settings` 读 locale/timezone）。
- **RFC2047 收件侧接入**：确认收件主题/附件名渲染前过 `decodeEncodedWord`（若 plan-03/04 收件解析已在此处理则仅校验，否则在渲染层加）——以 UTF-8 邮件测试为准。

- [ ] **Step 1: 改 `SettingsNav` label 为 `translate('settings.section.xxx', {}, locale)`**（通过 props 注入 locale 或 `useT()`）。
- [ ] **Step 2: 改设置各 Section 组件的标题/描述/按钮用 `useT()`。**
- [ ] **Step 3: 改 `mails/page.tsx` / `VirtualMessageList` 空状态用 `t('mail.empty.*')`。**
- [ ] **Step 4: `layout.tsx` 包 `<I18nProvider>`。**
- [ ] **Step 5: `npx tsc --noEmit` → 无错误。`npx vitest run`（全量回归，确保本计划所有测试仍绿 + 不破坏既有）。**
- [ ] **Step 6: 手测联调**：设置中心 10 分区全部可达且功能正常（账号/规则/LLM 外链跳转正确；签名多套 + 分配生效；导入导出 round-trip；切换语言即时生效；可观测性数据正确）。
- [ ] **Step 7: Commit**

```bash
git add src/app/settings/page.tsx src/components/settings/ src/components/mail/VirtualMessageList.tsx src/app/mails/page.tsx src/app/layout.tsx
git commit -m "feat(settings): wire i18n into settings center + list empty states (min coverage) + I18nProvider at root"
git push
```

---

## 验收标准

- [ ] **统一设置中心**：旧 4-tab 重构为左侧分区导航（账号/显示主题/快捷键/规则/签名/调度/LLM/数据/可观测性/语言）+ 主面板；账号/规则/LLM 分区正确外链/嵌入 plan-02/10/12 既有管理页（**不重造**）；scheduler toggle 仍工作。
- [ ] **签名多套 + 按账号分配**：`signatures` 表支持多套 CRUD；`PUT /api/accounts/[id]/signature` 分配/取消；删签名级联置空账号分配；按账号读取签名供撰写追加（plan-05 衔接）。
- [ ] **数据导入导出**：`GET /api/export?type=&format=` 导出 messages/todos/contacts 为 CSV（含 BOM，Excel 中文不乱码）/JSON（带 count/exportedAt）；`POST /api/import` 导入反序列化 + 按 message_id/email 业务主键 upsert 去重 + 非法行记错不中断；CSV RFC4180 转义（逗号/引号/换行）正确；联系人导出复用 plan-09。
- [ ] **i18n 框架**：`zh-CN.json`/`en-US.json` 字典；`translate(key,params,locale)` 取值 + `{name}` 插值 + 回退链（locale→zh-CN→key 本身）；`formatDate/formatNumber` 按 locale/timezone 本地化；`I18nProvider` + `useT()`；设置中心 + 列表空状态文案接入；切换语言即时生效。
- [ ] **RFC2047 解码 + UTF-8 邮件**：`decodeEncodedWord` 正确解码 `=?UTF-8?B?=?=`/`=?UTF-8?Q?=?=` 中文 + 多段拼接 + 裸 ASCII 混合；解码失败回退原文；含中文/多语种 encoded-word 主题与附件名不乱码（UTF-8 邮件综合校验）。
- [ ] **可观测性**：`createLogger(scope)` 结构化日志（`{ts,level,scope,msg,meta}` 写 `data/logs/*.ndjson` + 内存 ring buffer，替代裸 console.log）；`recordMetric/snapshot` 覆盖 sync.latency_ms/idle.online_ratio/jobs.backlog/llm.cost_usd/imap.error_rate；`GET /api/observability/health`（账号连接健康度 + jobs backlog，accounts 表不存在时 graceful degrade）；`GET /api/observability/logs`（过滤 + ndjson 导出）；`GET /api/observability/metrics`；设置中心可观测性分区展示 + 可导出。
- [ ] `npm test` 全绿（io/{csv,serializers}、api/{export,import,signatures,observability}、i18n/{translate,rfc2047,format,utf8-mail}、log/{logger,metrics}）。
- [ ] `npx tsc --noEmit` 无类型错误。
- [ ] （P2 预留）全站文案 i18n 完整覆盖（本计划仅最小覆盖设置中心 + 空状态）；指标持久化（当前内存 ring buffer 进程重启清空，持久化待 plan-17 日志体系扩展）；GB18030/Big5 等 GBK 外字符集（依赖 full-icu/iconv-lite）。

## 依赖

- **子项目 2（多账号 + accounts 表）**：`accounts` 表 + `signature_id` 列（本计划 ALTER 加列，不存在则 KV 回退）+ `/api/accounts`（账号分区外链）；`GET /api/observability/health` 读 accounts.sync_status/sync_error/last_synced_at。
- **子项目 9（联系人）**：`contacts` 表 + vCard/CSV 导出 serializer（联系人导出复用/转发 plan-09）。
- **子项目 10（规则）**：`/api/rules` + 规则管理页（规则分区外链，不重造）。
- **子项目 12（AI + LLM 配置）**：`/api/llm/config` + `/api/llm/test` + LLM 配置中心（LLM 分区外链/嵌入，不重造）。
- **子项目 14（UX）**：`ThemeProvider` + `ThemeToggle`（显示主题分区嵌入）+ `hotkeys` registry/settings + `HotkeyHelpOverlay`（快捷键分区嵌入）。
- **plan-05（签名按账号追加）**：撰写时 `GET /api/accounts/[id]/signature` 取签名 append（plan-05 负责 append 逻辑，本计划提供存储 + 分配）。
- **plan-17（本地运行 + 日志）**：`data/logs/` 与 `data/actbox.db` 同属本地数据 + `.gitignore`；本计划 logger 写 `data/logs/*.ndjson` 复用该目录约定。
- **现有**：`src/app/api/settings/route.ts`（settings KV GET/PATCH，locale/timezone/account_signatures 存此）、`src/lib/db/{schema.ts,index.ts}`（`getDb()`）、`src/components/RichTextEditor.tsx`（签名正文编辑复用）、`src/app/settings/page.tsx`（重构对象）、`src/app/layout.tsx`（Provider 挂载）。
- **新依赖**：无强制新增（CSV 手写、RFC2047 用 `TextDecoder`/`Buffer`）。**条件依赖**：若 GBK 解码（full-icu 不可用）则 `npm i iconv-lite`（Task 4 Step 5 决定）。

## 风险

- **accounts/jobs 表未在该工作树落地（plan-02 未完成）**：健康度端点读这些表会崩。**缓解**：`tableExists` 探测 + graceful degrade（`available:false`、空数组）；签名分配 `hasColumn` 探测 + `account_signatures` KV 回退；`memDb` helper 测试用自己建的 accounts/jobs mock 表，不依赖 plan-02 产物。
- **GBK/GB18030 解码依赖 full-icu**：Node 默认 small-icu 不含 GBK，`new TextDecoder('gbk')` 可能抛 RangeError。**缓解**：`fatal:false` + try/catch 回退原文段（不崩）；若需完整中文编码支持 `npm i iconv-lite`；GBK 测试用例按实际 ICU 支持标注（CI full-icu 则全绿，small-icu 则 GBK 用例 skip，UTF-8 用例必过）。
- **JSON `resolveJsonModule`**：`import zhCN from './locales/zh-CN.json'` 需 tsconfig `resolveJsonModule: true`。**缓解**：Task 4 内确认/补 tsconfig；若未开则改用 `fs.readFileSync` 加载（server 端）+ 字符串 inline（client 端），但静态 import 更简单优先。
- **导入 CSV 列名不匹配**：用户从别的客户端导出的 CSV 列名与 actbox 期望列（message_id/subject/from/...）不一致 → 导入静默 skip 全部。**缓解**：导入端点返回详细 `{ imported, skipped, errors }` + UI 显示「列名不匹配」提示；文档列出期望列名；提供「列名映射」UI（P2）。
- **大邮件正文导入 OOM**：一次性 `JSON.parse(data)` 巨型文件 OOM。**缓解**：本地单用户、邮件量有限（万级），`JSON.parse` 足够；CSV 逐行 parse 已流式友好；P2 若需超大导入改流式解析。
- **日志 `appendFileSync` 阻塞事件循环**：高频日志写盘同步 IO 阻塞。**缓解**：本地单机日志频率低（同步事件级，非逐封字符）；ring buffer 内存查询走内存（API 查询不读盘）；P2 可改 `fs.createWriteStream` 异步缓冲。
- **i18n key 漂移（字典缺 key）**：新增 UI 文案忘加 locale key → 显示 key 本身（如 `settings.section.xxx`）。**缓解**：translate 回退到 key 本身（不崩，但可见）；Task 6 最小覆盖集中加 key；后续可加「缺失 key 检测」脚本（P2）。
- **设置中心外链目标页不存在**：账号/规则/LLM 管理页若对应 plan 未实现，外链 404。**缓解**：分区卡片显示「即将上线」+ 链接条件渲染（`/api/accounts` 可达才显示外链按钮，否则 disabled + 说明）；以手测各分区可达为准。
- **CSV 导出 `sender` 列别名 `from` 是 SQL 保留字风险**：`SELECT sender as \`from\`` 已用反引号转义（SQLite 接受）；测试断言导出含 `from` 列名。**缓解**：保留反引号；若方言问题改导出列名为 `sender`（与表一致）并在 import 双向兼容，以 export/import 测试 round-trip 为准。
