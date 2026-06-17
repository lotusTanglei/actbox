# 子项目 18 — 导出待办 → Obsidian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把 actbox 的待办按范围（日期段/状态/优先级/context/来源邮件）导出成 **Obsidian 友好 Markdown**——可选 frontmatter（范围/数量/导出时间/来源）+ `- [ ]`/`- [x]` 复选框列表，每条带元数据（📅 截止 / 🔴 优先级 / context / 📧 来源邮件主题+链接）——写入用户可配置的 Obsidian vault 或直接下载，供在 Obsidian 里归纳总结。

**Architecture:** 方案 B（详见 spec §0/子项目 18）。本地单机、单进程、单 SQLite(WAL)、单用户不变。核心原则是**纯函数 + 复用现有数据**：
1. **导出为纯函数** `renderTodosMarkdown(todos, opts): string`——输入一组 todo 行（已 join 好来源邮件信息）+ 导出选项（frontmatter 开关/范围标签/时区），输出 markdown 字符串。无 IO、无副作用、可快照测试。范围筛选（日期段/状态/优先级/context/来源邮件）是另一个纯函数 `filterTodosForExport(rows, range): rows`，便于单独测。
2. **数据读取**：`GET`-等价的查询函数读 `todos` 表，左连 `messages`（`todos.source_message_id = messages.message_id`）取来源邮件主题与可点击链接（链接指向 `/mails/{messages.id}`）。查询逻辑集中在 `/api/todos/export` 端点内（server-only，不走纯函数，因依赖 `getDb()`）。
3. **去向二选一**：① 写 vault 文件（server 端 `fs/promises.writeFile`，路径取 `settings.export.obsidianVault`，文件名按范围命名如 `todos-2026-W24.md` / `todos-2026-06.md`）；② 返回 markdown 供前端下载（`Content-Disposition: attachment` 或 `GET /api/todos/export/download`）。两者共用同一 `renderTodosMarkdown`。
4. **配置**：vault 路径存 settings KV（`export.obsidianVault`，默认空 → 空时强制走下载，不写文件）；`export.frontmatter`（默认 `true`）。无新表、无新依赖。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle + better-sqlite3 / vitest（环境 node，参考 `vitest.config.ts`）。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。**无外部依赖，可独立先做**（只读现有 `todos` + `messages` + `settings` 表，不动 schema）。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。纯函数（渲染 + 筛选 + 文件名生成）以单测覆盖；端点（export 写文件 / 下载）注入内存库测试；UI 范围选择器 + 预览以手测覆盖。内存库 helper 与 `src/__tests__/db/schema.test.ts` 同款写法（`Database(':memory:')` + 手写建表 DDL），本计划新建 `src/__tests__/helpers/memDb.ts` 收拢建表语句（含 todos/messages/settings 三表）供 export 端点测试复用。

---

## 文件结构

- Create: `src/lib/export/markdown.ts` — 纯函数：`renderTodosMarkdown(todos, opts)`（frontmatter + 复选框 + 元数据）、`buildExportFilename(range, now)`（按范围命名）、`type ExportRange`、`type ExportOptions`、`type TodoExportRow`
- Create: `src/lib/export/filter.ts` — 纯函数：`filterTodosForExport(rows, range)`（状态/优先级/context/tag/来源邮件 客户端可复用的纯筛选；日期段筛选因命中 DB 索引放端点 SQL 层，纯函数覆盖状态/优先级/context/来源 message 不空的判定，便于测）
- Create: `src/app/api/todos/export/route.ts` — `POST /api/todos/export`（body=range + `{ mode: 'file'|'text' }`）→ 查库（含日期段/状态/优先级/context/来源邮件 SQL 筛选 + 左连 messages）→ `renderTodosMarkdown` → 写 vault 文件 或 返回 markdown
- Create: `src/app/api/todos/export/download/route.ts` — `POST`（body=range）→ 返回 `text/markdown` + `Content-Disposition: attachment; filename=...`（供"下载"按钮）
- Modify: `src/app/api/settings/route.ts` — 无代码改动（现有 PATCH 已支持任意 key-value，`export.obsidianVault` / `export.frontmatter` 直接可用）；仅在文档/待确认中记录这两个 key
- Create: `src/lib/export/vault.ts` — `writeToVault(vaultPath, filename, content): Promise<{path}>`（封装 `fs/promises.writeFile` + 路径安全校验：禁止 `..`、必须绝对路径、父目录不存在则 `mkdir recursive`）+ `resolveVaultPath(setting)`（读 settings，空则抛 `VAULT_NOT_CONFIGURED`）
- Create: `src/app/todos/page.tsx` 或在现有待办页 — 待办页"导出"入口 + 范围选择器 + 预览（若待办页已存在则 Modify，否则 Create；见"待确认"）
- Create: `src/components/export/ExportDialog.tsx` — 导出对话框（范围选择器：日期段类型 created/done/due + 起止日 / 状态 all|pending|done / 优先级 high|medium|low 多选 / context 文本 / 来源邮件 only-linked 开关 / frontmatter 开关 / 预览（实时调 `mode:'text'` 拉前 N 条）/ 「写入 vault」+「下载」两按钮）
- Test: `src/__tests__/export/markdown.test.ts`（渲染纯函数：frontmatter / 复选框 / 元数据 / 来源链接 / 快照）
- Test: `src/__tests__/export/filter.test.ts`（筛选纯函数：状态/优先级/context/来源邮件）
- Test: `src/__tests__/export/filename.test.ts`（文件名按范围：周 `todos-2026-W24.md` / 月 `todos-2026-06.md` / 区间 / 全部）
- Test: `src/__tests__/api/todos-export.test.ts`（端点：mode=text 返回 markdown / mode=file 写 vault / 日期段筛选 / 左连 messages 取主题 / vault 未配置时 file 模式 400 / 下载端点 content-type + filename）
- Create（测试 helper）: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 建表 DDL（todos/messages/settings 三表，与 `schema.test.ts` 一致）+ `seedTodos`/`seedMessage` 便捷函数

---

## 任务

### Task 1: 导出纯函数 `renderTodosMarkdown` + 文件名生成

**Files:**
- Create: `src/lib/export/markdown.ts`
- Test: `src/__tests__/export/markdown.test.ts`

**关键设计：** 全部纯函数，无 IO。类型定义先固化：

```ts
// src/lib/export/markdown.ts
export type ExportGranularity = 'day' | 'week' | 'month' | 'range' | 'all'

/** 范围描述（仅用于 frontmatter 文案 + 文件名，不含筛选语义；筛选语义在 filter/端点） */
export interface ExportRange {
  granularity: ExportGranularity
  dateField: 'created' | 'done' | 'due'     // 按 created_at / updated_at(done 时点) / due_date 筛选
  from?: string   // ISO date 'YYYY-MM-DD'
  to?: string     // ISO date 'YYYY-MM-DD'
  status: 'all' | 'pending' | 'done'
  priorities: Array<'high' | 'medium' | 'low'>   // 空数组 = 不过滤
  context?: string
  onlyLinked: boolean                            // 仅导出来源邮件关联的待办
}

export interface ExportOptions {
  frontmatter: boolean       // 是否输出 YAML frontmatter
  vaultPath?: string         // 仅 frontmatter 记录用，不参与渲染逻辑
  timezone?: string          // 默认 'Asia/Shanghai'，用于导出时间显示
  sourceBaseUrl?: string     // 来源邮件链接前缀，默认 '/mails/'，拼成 `/mails/{messages.id}`
  now?: () => number          // 测试注入
}

/** join 后的行：todo 字段 + 来源邮件主题/主键（无关联则 null） */
export interface TodoExportRow {
  id: number
  title: string
  status: 'pending' | 'done'
  priority: 'high' | 'medium' | 'low' | null
  context: string | null
  dueDate: string | null
  sourceMessageId: string | null
  sourceSubject: string | null
  sourceMailPk: number | null   // messages.id，用于生成 /mails/{pk} 链接；无关联 null
}
```

渲染规则（严格）：
- **frontmatter**（`opts.frontmatter` 为真时输出，包裹在 `---` 之间，YAML）：
  ```yaml
  ---
  export_source: actbox
  export_at: 2026-06-17T09:00:00+08:00
  range: 2026-W24
  date_field: created
  status: pending
  total: 3
  ---
  ```
  `export_at` 用 `Intl.DateTimeFormat('sv-SE', { timeZone, hour12:false })`-等价生成 `YYYY-MM-DDTHH:mm:ssZ`；`range` 取 `buildExportFilename` 的范围段（如 `2026-W24` / `2026-06` / `2026-06-10..2026-06-17` / `all`）。
- **复选框**：`status==='done'` → `- [x]`，否则 `- [ ]`。标题原样输出，标题内已有的 markdown 特殊字符（`|`、行首 `#`）不做转义（保持 Obsidian 友好；标题来自 todo，用户自填，预期无破坏性字符）。
- **元数据**（标题后同行或下一行）：采用**标题后括号紧凑元数据**形式——
  `- [x] 跟进合同签署 📅 2026-06-20 🔴 high #work 📧 [客户回复](/mails/42)`
  规则：📅 = `dueDate`（有则输出）；🔴 优先级 = high/🟡=medium/🟢=low（有则输出 emoji+词，用 emoji 区分：high=🔴 high、medium=🟡 medium、low=🟢 low）；context 非 null 时输出 `#context`（空格转 `_`）；来源邮件 `sourceMailPk != null` 时输出 `📧 [主题或(无主题)]({sourceBaseUrl}{pk})`，主题取 `sourceSubject ?? '(无主题)'`，主题含 `]` 时转义为 `\]`。无元数据字段时只输出复选框+标题。
- **排序**：渲染按传入顺序（端点已排好序：优先级 high>medium>low > dueDate 升序 > createdAt desc），纯函数不重排。
- **空结果**：frontmatter 后正文输出一行 `> （该范围内暂无待办）`。

- `buildExportFilename(range, now)`：返回 `{ stem, ext:'md', rangeLabel }`。
  - granularity=week → `todos-${isoYear}-W${isoWeek}.md`（ISO 周，如 `todos-2026-W24.md`）；周锚点取 `range.from` 所在周。
  - month → `todos-${YYYY}-${MM}.md`（如 `todos-2026-06.md`）。
  - day → `todos-${YYYY-MM-DD}.md`。
  - range → `todos-${from}..${to}.md`。
  - all → `todos-all-${YYYY-MM-DD}.md`。
  - ISO 周用纯函数手算（周四所在年的周数，不引依赖）。

- [ ] **Step 1: 写纯函数失败测试**

```ts
// src/__tests__/export/markdown.test.ts
import { describe, it, expect } from 'vitest'
import { renderTodosMarkdown, buildExportFilename, type TodoExportRow, type ExportRange, type ExportOptions } from '@/lib/export/markdown'

const row = (over: Partial<TodoExportRow>): TodoExportRow => ({
  id: 1, title: 't', status: 'pending', priority: null, context: null,
  dueDate: null, sourceMessageId: null, sourceSubject: null, sourceMailPk: null, ...over,
})
const NOW = new Date('2026-06-17T01:00:00Z').getTime()  // 09:00 CST
const baseOpts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  frontmatter: true, timezone: 'Asia/Shanghai', sourceBaseUrl: '/mails/', now: () => NOW, ...over,
})
const range = (over: Partial<ExportRange> = {}): ExportRange => ({
  granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false, ...over,
})

describe('renderTodosMarkdown - frontmatter', () => {
  it('frontmatter=true 输出 YAML 头，含 export_source/export_at/range/total', () => {
    const md = renderTodosMarkdown([row({ id: 1, title: 'A' })], range(), baseOpts())
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('export_source: actbox')
    expect(md).toContain('range: all')
    expect(md).toContain('total: 1')
    expect(md).toContain('export_at: 2026-06-17T09:00:00+08:00')   // UTC+8
  })
  it('frontmatter=false 无 YAML 头，直接列复选框', () => {
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
  it('截止/优先级/context/来源邮件元数据齐全', () => {
    const md = renderTodosMarkdown(
      [row({ id: 1, title: '跟进合同', dueDate: '2026-06-20', priority: 'high', context: '工作', sourceSubject: '客户回复', sourceMailPk: 42 })],
      range(), baseOpts({ frontmatter: false }),
    )
    expect(md).toContain('📅 2026-06-20')
    expect(md).toContain('🔴 high')
    expect(md).toContain('#工作')
    expect(md).toContain('📧 [客户回复](/mails/42)')
  })
  it('优先级 medium=🟡 low=🟢；无优先级不输出', () => {
    const md = renderTodosMarkdown(
      [row({ id: 1, title: 'a', priority: 'medium' }), row({ id: 2, title: 'b', priority: 'low' }), row({ id: 3, title: 'c', priority: null })],
      range(), baseOpts({ frontmatter: false }),
    )
    expect(md).toContain('🟡 medium'); expect(md).toContain('🟢 low')
    const cLine = md.split('\n').find(l => l.includes('] c'))!
    expect(cLine).not.toMatch(/🔴|🟡|🟢/)
  })
  it('context 空格转 _；来源主题含 ] 转义', () => {
    const md = renderTodosMarkdown(
      [row({ id: 1, title: 'a', context: 'side project', sourceSubject: 're:[xx]', sourceMailPk: 7 })],
      range(), baseOpts({ frontmatter: false }),
    )
    expect(md).toContain('#side_project')
    expect(md).toContain('📧 [re:\\[xx\\]](/mails/7)')
  })
  it('无关联邮件不输出 📧', () => {
    const md = renderTodosMarkdown([row({ title: 'a' })], range(), baseOpts({ frontmatter: false }))
    expect(md).not.toContain('📧')
  })
  it('空结果输出提示行', () => {
    const md = renderTodosMarkdown([], range(), baseOpts({ frontmatter: false }))
    expect(md).toContain('> （该范围内暂无待办）')
  })
  it('sourceBaseUrl 自定义拼链接', () => {
    const md = renderTodosMarkdown([row({ title: 'a', sourceSubject: 's', sourceMailPk: 3 })], range(), baseOpts({ frontmatter: false, sourceBaseUrl: 'obsidian://actbox/mail/' }))
    expect(md).toContain('](obsidian://actbox/mail/3)')
  })
})

describe('buildExportFilename', () => {
  it('week → todos-2026-W24.md（from=2026-06-17 所在 ISO 周）', () => {
    const f = buildExportFilename(range({ granularity: 'week', from: '2026-06-17' }), NOW)
    expect(f.name).toBe('todos-2026-W24.md')
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
    expect(f.name).toBe('todos-all-2026-06-17.md')   // 按 now 的 CST 日期
  })
  it('rangeLabel 与 frontmatter range 一致', () => {
    expect(buildExportFilename(range({ granularity: 'week', from: '2026-06-17' }), NOW).rangeLabel).toBe('2026-W24')
  })
})

describe('renderTodosMarkdown - 快照', () => {
  it('典型一周导出快照稳定', () => {
    const rows = [
      row({ id: 1, title: '回复客户合同', status: 'done', priority: 'high', dueDate: '2026-06-15', context: 'work', sourceSubject: '合同v3', sourceMailPk: 10 }),
      row({ id: 2, title: '准备周会材料', status: 'pending', priority: 'medium', dueDate: '2026-06-18', context: 'work' }),
      row({ id: 3, title: '买牛奶', status: 'pending', priority: null, context: 'life' }),
    ]
    const md = renderTodosMarkdown(rows, range({ granularity: 'week', from: '2026-06-15', to: '2026-06-21', status: 'all' }), baseOpts())
    expect(md).toMatchFileSnapshot('__snapshots__/export-week.typical.md')
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/export/markdown.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/lib/export/markdown.ts`**：`renderTodosMarkdown` + `buildExportFilename`（含 ISO 周纯函数手算）+ 上列类型导出。frontmatter 的 `export_at` 用 `Intl.DateTimeFormat` 拼 ISO 字符串；优先级 emoji map；context 空格转 `_`；主题 `]`/`\` 转义。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/export/markdown.test.ts` → PASS（含快照首次生成）。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/export/markdown.ts src/__tests__/export/markdown.test.ts src/__tests__/export/__snapshots__/
git commit -m "feat(export): renderTodosMarkdown pure fn (frontmatter + checkbox + metadata + source link) + buildExportFilename (ISO week/month/range/all)"
git push
```

---

### Task 2: 范围筛选纯函数（状态/优先级/context/来源邮件）

**Files:**
- Create: `src/lib/export/filter.ts`
- Test: `src/__tests__/export/filter.test.ts`

**关键设计：** 日期段筛选（created/done/due 的 from..to）放在端点 SQL 层（命中索引、避免全表拉进内存），本纯函数只覆盖**内存可判定**的筛选维度——状态、优先级、context、来源邮件关联——便于纯函数测试，且前端预览/二次筛选可复用。函数签名：

```ts
// src/lib/export/filter.ts
import type { ExportRange, TodoExportRow } from './markdown'

/** 客户端可复用的纯筛选：状态/优先级/context/来源邮件关联。
 *  日期段筛选（range.from/to × dateField）由端点 SQL 处理，本函数不重复。 */
export function filterTodosForExport(rows: TodoExportRow[], range: Pick<ExportRange, 'status' | 'priorities' | 'context' | 'onlyLinked'>): TodoExportRow[]
```

规则：
- `status`：`'all'` 不动；`'pending'` 保留 `status==='pending'`；`'done'` 保留 `status==='done'`。
- `priorities`：非空数组时，仅保留 `priority` 在数组内的行（`priority=null` 的行排除）；空数组 = 不过滤。
- `context`：非空字符串时，保留 `context` 与之**大小写不敏感精确相等**的行（不做子串匹配，避免误伤；空 = 不过滤）。
- `onlyLinked`：为真时仅保留 `sourceMessageId != null`（即 `sourceMailPk != null`）的行。
- 各条件**AND** 组合。

- [ ] **Step 1: 写纯函数失败测试**

```ts
// src/__tests__/export/filter.test.ts
import { describe, it, expect } from 'vitest'
import { filterTodosForExport } from '@/lib/export/filter'
import type { TodoExportRow } from '@/lib/export/markdown'

const row = (over: Partial<TodoExportRow>): TodoExportRow => ({
  id: 1, title: 't', status: 'pending', priority: null, context: null,
  dueDate: null, sourceMessageId: null, sourceSubject: null, sourceMailPk: null, ...over,
})

describe('filterTodosForExport', () => {
  it('status=pending 只留 pending', () => {
    const got = filterTodosForExport(
      [row({ id: 1, status: 'pending' }), row({ id: 2, status: 'done' })],
      { status: 'pending', priorities: [], context: undefined, onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('priorities 非空只留匹配优先级（null 被排除）', () => {
    const got = filterTodosForExport(
      [row({ id: 1, priority: 'high' }), row({ id: 2, priority: 'low' }), row({ id: 3, priority: null })],
      { status: 'all', priorities: ['high', 'medium'], context: undefined, onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('priorities 空=不过滤', () => {
    const rows = [row({ id: 1, priority: null }), row({ id: 2, priority: 'high' })]
    expect(filterTodosForExport(rows, { status: 'all', priorities: [], context: undefined, onlyLinked: false })).toHaveLength(2)
  })
  it('context 大小写不敏感精确匹配', () => {
    const got = filterTodosForExport(
      [row({ id: 1, context: 'Work' }), row({ id: 2, context: 'work-out' }), row({ id: 3, context: 'work' })],
      { status: 'all', priorities: [], context: 'WORK', onlyLinked: false },
    )
    expect(got.map(r => r.id)).toEqual([1, 3])
  })
  it('onlyLinked 只留有来源邮件的行', () => {
    const got = filterTodosForExport(
      [row({ id: 1, sourceMailPk: 5 }), row({ id: 2, sourceMailPk: null })],
      { status: 'all', priorities: [], context: undefined, onlyLinked: true },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
  it('多条件 AND 组合', () => {
    const got = filterTodosForExport(
      [row({ id: 1, status: 'pending', priority: 'high', context: 'work', sourceMailPk: 1 }),
       row({ id: 2, status: 'pending', priority: 'high', context: 'work', sourceMailPk: null }),
       row({ id: 3, status: 'done', priority: 'high', context: 'work', sourceMailPk: 1 })],
      { status: 'pending', priorities: ['high'], context: 'work', onlyLinked: true },
    )
    expect(got.map(r => r.id)).toEqual([1])
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/export/filter.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/lib/export/filter.ts`**：`filterTodosForExport`（AND 组合，context `toLocaleLowerCase` 精确比，onlyLinked 看 `sourceMailPk != null`）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/export/filter.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/lib/export/filter.ts src/__tests__/export/filter.test.ts
git commit -m "feat(export): filterTodosForExport pure fn (status/priority/context/only-linked, AND-combined)"
git push
```

---

### Task 3: memDb helper + 查询/写文件/下载端点

**Files:**
- Create: `src/__tests__/helpers/memDb.ts`
- Create: `src/lib/export/vault.ts`
- Create: `src/app/api/todos/export/route.ts`
- Create: `src/app/api/todos/export/download/route.ts`
- Test: `src/__tests__/api/todos-export.test.ts`

**关键设计：**
- **`memDb.ts`**：复刻 `src/__tests__/db/schema.test.ts` 的内存库写法，导出 `memDb()` 返回 drizzle 实例（建 todos/messages/settings 三表），并暴露 `seedTodo(db, over)` / `seedMessage(db, over)` 便捷插入。端点测试靠 `vi.mock('@/lib/db', () => ({ getDb: () => db }))` 注入。
- **查询（端点内 SQL）**：`POST /api/todos/export` body = `ExportRange & { mode: 'file'|'text', filename?: string }`。SQL 用 drizzle：
  - 基础 `db.select({ ...todos 全列, mailSubject: messages.subject, mailPk: messages.id }).from(todos).leftJoin(messages, eq(todos.sourceMessageId, messages.messageId))`。
  - **日期段**：`dateField==='created'` → `between(todos.createdAt, from, to)`；`'due'` → `between(todos.dueDate, from, to)`（字符串比较，ISO 日期可字典序比）；`'done'` → `dateField==='done'` 用 `updatedAt` 近似完成时点（schema 无独立 completedAt，见"待确认"）。from/to 缺省则不限。
  - **状态**：`status !== 'all'` → `eq(todos.status, ...)`。
  - **优先级**：`priorities.length` → `inArray(todos.priority, ...)`。
  - **context**：非空 → `eq(todos.context, ...)`（精确）。
  - **onlyLinked**：`isNotNull(todos.sourceMessageId)`。
  - 排序：`priority`（high>medium>low，用 `CASE` 或拉回内存排）、`dueDate` 升序（nulls last）、`createdAt` desc。优先级排序用端点拉全量后内存 `sortByPriority` 排（数据量本地单用户可接受）。
  - 映射为 `TodoExportRow[]`（`sourceMailPk = messages.id ?? null`，`sourceSubject = messages.subject ?? null`）后，再调 `filterTodosForExport` 做一次**幂等**纯筛选（双保险，且未来纯函数补维度时端点零改动），最后 `renderTodosMarkdown`。
- **`mode:'text'`** → `{ markdown, filename: name }`（200）。
- **`mode:'file'`** → 读 `settings.export.obsidianVault`；为空 → 400 `{ error: 'VAULT_NOT_CONFIGURED' }`；否则 `writeToVault(vaultPath, name, markdown)` 写盘 → `{ path: <绝对路径>, filename: name }`（200）。
- **`vault.ts`**：
  ```ts
  export async function writeToVault(vaultPath: string, filename: string, content: string): Promise<string>
  export async function resolveVaultPath(db): Promise<string>   // 读 settings，空抛 VAULT_NOT_CONFIGURED
  ```
  - 路径安全：`filename` 仅允许 `[A-Za-z0-9._-]+`（`buildExportFilename` 已保证，但端点再校验）；拼接 `path.join(vaultPath, filename)`；校验 `resolve` 后仍在 `vaultPath` 之下（防 `..` 逃逸，虽然文件名已白名单，纵深防御）；`mkdir(recursive:true)` 父目录；`writeFile` 全量覆盖（同名再导出即更新，符合"归纳"反复导出场景）。
- **下载端点 `POST /api/todos/export/download`**：同样查询 + 渲染，返回 `new NextResponse(markdown, { headers: { 'content-type':'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } })`。

- [ ] **Step 1: 写端点失败测试**

```ts
// src/__tests__/api/todos-export.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

let db: any
vi.mock('@/lib/db', () => ({ getDb: () => db }))

// 内存库（与 memDb helper 等价；此处内联以测端点）
function freshDb() {
  const sqlite = Database(':memory:')
  sqlite.exec(`CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, due_date TEXT, priority TEXT, context TEXT, status TEXT NOT NULL DEFAULT 'pending', source_message_id TEXT, source_subject TEXT, source_from TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
               CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, subject TEXT, sender TEXT, recipient TEXT, body TEXT, body_html TEXT, received_at INTEGER, processed_at INTEGER NOT NULL DEFAULT (unixepoch()), direction TEXT NOT NULL DEFAULT 'in', is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0, todo_count INTEGER NOT NULL DEFAULT 0);
               CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  db = drizzle(sqlite, { schema })
}

function req(url: string, init: any = {}) {
  return new Request(url, { headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => freshDb())

describe('POST /api/todos/export', () => {
  it('mode=text 返回 markdown（含左连邮件主题+链接）', async () => {
    db.insert(schema.messages).values({ id: 10, messageId: '<m1>', subject: '客户回复' }).run()
    db.insert(schema.todos).values({ id: 1, title: '跟进', status: 'pending', priority: 'high', dueDate: '2026-06-20', sourceMessageId: '<m1>' }).run()
    const { POST } = await import('@/app/api/todos/export/route')
    const r = await POST(req('http://x/api/todos/export', { method: 'POST', body: JSON.stringify({ granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false, mode: 'text' }) }) as any)
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.markdown).toContain('- [ ] 跟进')
    expect(j.markdown).toContain('📧 [客户回复](/mails/10)')
    expect(j.filename).toMatch(/todos-all-\d{4}-\d{2}-\d{2}\.md/)
  })
  it('mode=file vault 未配置 → 400 VAULT_NOT_CONFIGURED', async () => {
    db.insert(schema.todos).values({ title: 'x' }).run()
    const { POST } = await import('@/app/api/todos/export/route')
    const r = await POST(req('http://x/api/todos/export', { method: 'POST', body: JSON.stringify({ granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false, mode: 'file' }) }) as any)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('VAULT_NOT_CONFIGURED')
  })
  it('mode=file 写入 vault 路径', async () => {
    const dir = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/actbox-vault-'))
    db.insert(schema.settings).values({ key: 'export.obsidianVault', value: dir }).run()
    db.insert(schema.todos).values({ title: '导出我' }).run()
    const { POST } = await import('@/app/api/todos/export/route')
    const r = await POST(req('http://x/api/todos/export', { method: 'POST', body: JSON.stringify({ granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false, mode: 'file' }) }) as any)
    expect(r.status).toBe(200)
    const j = await r.json()
    const fs = await import('node:fs/promises')
    const content = await fs.readFile(j.path, 'utf8')
    expect(content).toContain('- [ ] 导出我')
  })
  it('日期段 by created 过滤（between）', async () => {
    const old = Date.UTC(2026, 5, 1) / 1000
    const recent = Date.UTC(2026, 5, 16) / 1000
    db.insert(schema.todos).values({ id: 1, title: '旧', createdAt: new Date(old * 1000) }).run()
    db.insert(schema.todos).values({ id: 2, title: '新', createdAt: new Date(recent * 1000) }).run()
    const { POST } = await import('@/app/api/todos/export/route')
    const r = await POST(req('http://x/api/todos/export', { method: 'POST', body: JSON.stringify({ granularity: 'range', dateField: 'created', from: '2026-06-10', to: '2026-06-20', status: 'all', priorities: [], onlyLinked: false, mode: 'text' }) }) as any)
    const j = await r.json()
    expect(j.markdown).toContain('新'); expect(j.markdown).not.toContain('旧')
  })
  it('status=pending 过滤；onlyLinked 只留关联邮件', async () => {
    db.insert(schema.messages).values({ id: 5, messageId: '<m>', subject: 's' }).run()
    db.insert(schema.todos).values({ id: 1, title: 'done', status: 'done' }).run()
    db.insert(schema.todos).values({ id: 2, title: 'linked', status: 'pending', sourceMessageId: '<m>' }).run()
    db.insert(schema.todos).values({ id: 3, title: 'bare', status: 'pending' }).run()
    const { POST } = await import('@/app/api/todos/export/route')
    const r = await POST(req('http://x/api/todos/export', { method: 'POST', body: JSON.stringify({ granularity: 'all', dateField: 'created', status: 'pending', priorities: [], onlyLinked: true, mode: 'text' }) }) as any)
    const j = await r.json()
    expect(j.markdown).toContain('linked')
    expect(j.markdown).not.toContain('done'); expect(j.markdown).not.toContain('bare')
  })
})

describe('POST /api/todos/export/download', () => {
  it('返回 text/markdown + attachment filename', async () => {
    db.insert(schema.todos).values({ title: 'd' }).run()
    const { POST } = await import('@/app/api/todos/export/download/route')
    const r = await POST(req('http://x/api/todos/export/download', { method: 'POST', body: JSON.stringify({ granularity: 'all', dateField: 'created', status: 'all', priorities: [], onlyLinked: false }) }) as any)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/markdown')
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="todos-all-\d{4}-\d{2}-\d{2}\.md"/)
    const text = await r.text()
    expect(text).toContain('- [ ] d')
  })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/api/todos-export.test.ts` → FAIL（路由/helper 不存在）。
- [ ] **Step 3: 实现** `helpers/memDb.ts` + `lib/export/vault.ts` + `/api/todos/export/route.ts`（POST：查询 SQL + 左连 + `filterTodosForExport` + `renderTodosMarkdown` + mode 分支）+ `/api/todos/export/download/route.ts`（POST：同查询渲染 → text/markdown attachment）。`dateField==='done'` 暂用 `updatedAt`（schema 无 completedAt，"待确认"中提）。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/api/todos-export.test.ts` → PASS。`npx tsc --noEmit`。
- [ ] **Step 5: Commit + push**

```bash
git add src/__tests__/helpers/memDb.ts src/lib/export/vault.ts src/app/api/todos/export/ src/__tests__/api/todos-export.test.ts
git commit -m "feat(export): /api/todos/export (mode text|file, range SQL filter, left-join messages) + download endpoint + memDb helper + vault write"
git push
```

---

### Task 4: 导出 UI（范围选择器 + 预览 + 写入 vault / 下载）+ 待办页入口 + settings key 约定

**Files:**
- Create: `src/components/export/ExportDialog.tsx`
- Modify or Create: `src/app/todos/page.tsx`（待办页；若已存在则加"导出"按钮 + 挂载 `ExportDialog`）
- Modify: `src/app/api/settings/route.ts` — 仅在注释/文档登记 `export.obsidianVault` / `export.frontmatter` 两个 key（现有 PATCH 已支持任意 key，**不改逻辑**；若 plan-15 设置中心 UI 已落地，建议在设置页"导出"分区加 vault 路径输入框——属可选衔接，本任务记为"待确认/衔接 plan-15"）
- Test: `src/__tests__/export/useExportPreview.test.ts`（hook：范围变化 → 调 `mode:'text'` 拉预览 markdown；防抖；loading/error 态。mocked fetch）

**关键设计：**
- **`ExportDialog`**（Modal）：范围选择器字段——
  - 粒度 `granularity`（day/week/month/range/all）
  - 日期字段 `dateField`（created/done/due）
  - `from`/`to` 日期选择器（粒度=range 时显示两个；week/month/day 时显示单个锚点；all 时隐藏）
  - `status`（all/pending/done 单选）
  - `priorities`（high/medium/low 多选 chip）
  - `context`（文本输入）
  - `onlyLinked`（开关：仅来源邮件关联待办）
  - `frontmatter`（开关，默认读 `settings.export.frontmatter` ?? true）
  - **预览区**：范围任一字段变化（防抖 300ms）→ `POST /api/todos/export { ...range, mode:'text' }` → 显示返回 markdown 的前 50 行（monospace `<pre>`），标题显示"共 N 条"。
  - 底部两按钮：**「写入 vault」**（`mode:'file'`）成功 toast `已写入 {path}`，失败（VAULT_NOT_CONFIGURED）提示去设置配置 vault 路径；**「下载」**（`mode:'download'`：POST download 端点 → blob → `a[download]` 触发保存）。
- **`useExportPreview(range)`**：返回 `{ markdown, total, loading, error }`，内部防抖 fetch。
- **待办页入口**：待办页头部加"📥 导出"按钮 → 打开 `ExportDialog`。若 `src/app/todos/page.tsx` 不存在（actbox 当前 todo 可能在别处渲染），在现有 todo 列表组件头部加按钮（实现时定位）。
- **settings key 约定**（文档化，不改 settings 路由逻辑）：
  - `export.obsidianVault`：vault 绝对路径，默认空（空→禁用写文件、只允许下载）。
  - `export.frontmatter`：`'true'`/`'false'`（KV 存字符串），默认 `'true'`。
  - 用户 vault 默认提示值：`/Users/dundundebaba/Documents/ob/Tanglei/`（从 CLAUDE.md 已知用户 vault 位置）。

- [ ] **Step 1: 写 `useExportPreview` hook 数据流失败测试**（mocked `fetch`：范围变化触发 POST `mode:'text'`；防抖后只发最后一次；返回 markdown + total；网络错误置 error 不崩）。`ExportDialog` 视觉/交互手测为主。
- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/export/useExportPreview.test.ts` → FAIL。
- [ ] **Step 3: 实现 `useExportPreview.ts` + `ExportDialog.tsx` + 待办页"导出"入口**（定位现有 todo 页面/组件挂载）。下载按钮用 `fetch` + `blob()` + `URL.createObjectURL` + `a.click()`。
- [ ] **Step 4: 运行确认通过** `npx vitest run src/__tests__/export/useExportPreview.test.ts` → PASS。`npx tsc --noEmit`。手测：范围切换预览更新、写入 vault（先在 settings 配 `export.obsidianVault`=/tmp 测试目录）生成文件、下载得 `.md`。
- [ ] **Step 5: Commit + push**

```bash
git add src/components/export/ExportDialog.tsx src/components/export/useExportPreview.ts src/app/todos/ src/__tests__/export/useExportPreview.test.ts
git commit -m "feat(export): ExportDialog (range picker + live preview + write-vault/download) + todos page entry + useExportPreview hook"
git push
```

---

### Task 5: 全量回归 + 收尾

**Files:** 无新文件

- [ ] **Step 1: `npx vitest run`（全量）** → 全绿（含本计划 export/{markdown,filter,useExportPreview}、api/todos-export + 既有 todo/messages/settings 不破坏）。
- [ ] **Step 2: `npx tsc --noEmit` → 无类型错误。**
- [ ] **Step 3: 手测清单**：① 待办页"导出"按钮打开对话框；② 切换粒度（日/周/月/区间/全部）+ 日期字段，预览实时更新；③ 状态/优先级/context/onlyLinked 筛选生效；④ frontmatter 开关切换，预览 YAML 头出现/消失；⑤ 「写入 vault」→ 在配置的 vault 目录出现 `todos-*.md`，Obsidian 打开复选框可勾；⑥ 「下载」→ 浏览器下载同名 `.md`；⑦ 来源邮件关联待办导出后带 `📧 [主题](/mails/{id})` 链接；⑧ vault 未配置时"写入 vault"提示去设置。
- [ ] **Step 4: Commit + push（若有收尾改动）**

```bash
git add -A
git commit -m "test(export): full regression green + manual export checklist verified"
git push
```

---

## 验收标准

- [ ] **纯函数 `renderTodosMarkdown`**：frontmatter 开关正确（`---` YAML 头含 `export_source/export_at/range/total`）；复选框 done=`- [x]`/pending=`- [ ]`；元数据 📅截止/🔴🟡🟢优先级/`#context`(空格转`_`)/📧来源邮件链接（主题 `]` 转义、`sourceBaseUrl` 可配）齐全；空结果提示行；快照稳定。
- [ ] **纯函数 `filterTodosForExport`**：状态/优先级(空=不过滤，null 排除)/context(大小写不敏感精确)/onlyLinked 各维度 AND 组合正确。
- [ ] **`buildExportFilename`**：week→`todos-2026-W24.md`（ISO 周）/month→`todos-2026-06.md`/range→`todos-FROM..TO.md`/day/all 正确；rangeLabel 与 frontmatter 一致。
- [ ] **端点 `/api/todos/export`**：mode=text 返回 markdown + filename；mode=file 写 vault（路径安全：白名单文件名 + 目录逃逸防护 + mkdir recursive），vault 未配置 400 `VAULT_NOT_CONFIGURED`；日期段(created/done/due)、状态、优先级、context、onlyLinked SQL 筛选准确；左连 messages 取主题 + `/mails/{id}` 链接。
- [ ] **下载端点**：返回 `text/markdown` + `Content-Disposition: attachment; filename="..."`。
- [ ] **UI**：范围选择器（粒度/日期字段/起止/状态/优先级/context/onlyLinked/frontmatter）+ 实时预览 + 「写入 vault」「下载」两按钮；待办页"导出"入口；vault 未配置时友好提示。
- [ ] **配置**：`export.obsidianVault`（默认空→禁写文件）/`export.frontmatter`（默认 true）经现有 settings KV 存取，**不改 settings 路由逻辑**。
- [ ] **Obsidian 可读**：导出 `.md` 在 Obsidian 中 frontmatter 被识别为 properties、`- [ ]`/`- [x]` 为可勾选任务、`#tag` 为标签、`[文本](/mails/x)` 为链接（用户可在 Obsidian 里把 `/mails/` 前缀映射为自定义协议或仅作引用）。
- [ ] `npm test` 全绿（export/{markdown,filter,useExportPreview}、api/todos-export）。
- [ ] `npx tsc --noEmit` 无类型错误。

---

## 依赖

- **现有（必需）**：`src/lib/db/{schema.ts,index.ts}`（`getDb()`、todos/messages/settings 表）、`src/app/api/todos/*`（导出入口挂在待办体系）、`src/app/api/settings/route.ts`（KV 存取 `export.*`）。
- **现有 schema 字段**：`todos.{id,title,due_date,priority,context,status,source_message_id,source_subject,source_from,created_at,updated_at}` + `messages.{id,message_id,subject}`（左连）。**注意**：schema **无 `completed_at`**，`dateField='done'` 日期段暂用 `updated_at` 近似（见"待确认"）。
- **新依赖**：无（渲染/筛选/ISO 周/文件名全手写纯函数；写文件用 `node:fs/promises`；下载用浏览器 blob）。无 drizzle 新运算符需求（`between`/`inArray`/`isNotNull`/`leftJoin` 均已在 drizzle-orm）。
- **可选衔接（非阻塞）**：plan-15（设置中心 UI）若落地，在其加"导出"分区暴露 `export.obsidianVault` 输入框；未落地则用户经现有 `PATCH /api/settings` 配置，本计划 UI 在 vault 未配置时提示。

---

## 风险

- **schema 无 `completed_at`，done 日期段不准**：按"完成时间"筛选只能用 `updated_at`（状态最后一次变更时间）近似，若 todo 改过其他字段会污染。**缓解**：`dateField='done'` 标注"近似（更新时间）"；长期方案是 plan-01 schema 演进加 `completed_at` 列（"待确认"提，本计划不动 schema）。
- **vault 路径写文件安全**：server 端写用户文件系统，路径校验失误可越界写。**缓解**：文件名白名单（`[A-Za-z0-9._-]+`，`buildExportFilename` 已保证 + 端点二次校验）、`path.resolve` 后断言仍在 `vaultPath` 目录内、`mkdir(recursive)` 仅创建 vault 下目录。
- **vault 未配置仍点写文件**：**缓解**：`resolveVaultPath` 空值抛 `VAULT_NOT_CONFIGURED` → 端点 400，UI 提示去设置。
- **来源邮件链接 `/mails/{id}` 在 Obsidian 内不可点开 actbox**：Obsidian 不识别自定义绝对路径。**缓解**：`sourceBaseUrl` 可配（默认 `/mails/`，用户可改成 `obsidian://actbox/mail/` 或留作引用）；验收只要求"链接文本与地址正确"，跨应用跳转为 P2（见 P2）。
- **ISO 周手算错误**：与 `date-fns`/moment 的 `ISO week` 偏差。**缓解**：用标准算法（周四所在年 + 年内周序），markdown 测试已断言 `2026-06-17 → W24`（已知正确值）。
- **大范围导出（全量多年）性能**：本地单用户数据量有限，但"全部"可能上千条。**缓解**：端点 SQL 用索引（`status/priority/context/created_at`），渲染为字符串拼接（非 React），可接受；超大时可加 `LIMIT` 预览（P2）。
- **并发同名文件覆盖**：反复导出同一周会覆盖 `todos-2026-W24.md`。**缓解**：属预期行为（"归纳"需反复更新同一文件），`writeFile` 全量覆盖；若用户需保留历史可手动改名或加 `export_at` 后缀（"待确认"）。

---

## 待确认（实现时与用户敲定）

1. **导出格式细节**：
   - 元数据布局：当前定为**标题同行紧凑**（`- [ ] 标题 📅 ... 🔴 ... #ctx 📧 [...]`）。替代方案是**下一行缩进子项**（`- [ ] 标题\n    - 📅 ...`）。用户偏好哪种？（紧凑更省行、Obsidian 任务元数据插件多支持同行；子项更易读。）
   - 优先级 emoji：🔴 high / 🟡 medium / 🟢 low 是否 OK？还是用文字 `[P1]`/`[P2]`/`[P3]`？
   - frontmatter 字段是否要加 `tags: [actbox/todos]` 便于 Obsidian 检索？
2. **默认范围**：打开导出对话框默认选什么？建议默认**本周 + status=pending + frontmatter=on**（最常用的"本周未完成归纳"）。还是默认"全部 pending"？
3. **是否复用用户既有 inbox daily-note 结构**：用户 vault 在 `/Users/dundundebaba/Documents/ob/Tanglei/`（CLAUDE.md 已知，inbox daily-note 在 `Tanglei/inbox/YYYY-MM-DD.md`）。是否把导出文件写到特定子目录（如 `Tanglei/todos/` 或 `Tanglei/inbox/`）？还是在 vault 根目录？是否追加到既有 daily-note 而非新建 `todos-*.md`？（当前计划：新建独立 `todos-*.md`，路径= `export.obsidianVault` 全量。）
4. **`dateField='done'` 的精度**：schema 无 `completed_at`，是否本计划顺带加该列（轻度 schema 改动，需 plan-01 迁移框架）？还是接受 `updated_at` 近似？
5. **同名覆盖 vs 带时间戳**：反复导出同一周是否覆盖（当前计划覆盖），还是每次带 `export_at` 后缀保留历史（`todos-2026-W24-20260617T0900.md`）？
6. **来源邮件链接形式**：`/mails/{id}`（actbox 内部路由，Obsidian 内不可点）vs `obsidian://actbox/mail/{id}`（需注册协议）vs 仅纯文本主题不生成链接。当前默认 `/mails/{id}` + `sourceBaseUrl` 可配。

---

## P2（预留，不在本期实现）

- **来源邮件跨应用跳转**：注册 `obsidian://actbox/mail/{id}` 自定义协议或在 actbox 起 localhost server，让 Obsidian 内链接能跳回 actbox 邮件详情。
- **`completed_at` 列 + 精确完成时间筛选**：随 plan-01 schema 演进加列，done 日期段改用真实完成时间。
- **Obsidian 反向同步**：用户在 Obsidian 勾选任务后回写 actbox（监听 vault 文件变更，解析 `- [x]` → `PATCH /api/todos/{id}`）——双向同步，复杂度高，P2。
- **追加到 daily-note**：导出时可选"追加到今天的 inbox daily-note"（复用全局指令的 inbox 结构），而非新建独立文件。
- **模板化**：用户自定义导出模板（Obsidian template 语法 / Handlebars），frontmatter 字段与元数据布局可配。
- **增量导出**：记录上次导出时间，仅导出"新增/变更"待办，追加到既有文件。
- **附件导出**：来源邮件附件一并导出到 vault（链接 → 本地文件）。
```
