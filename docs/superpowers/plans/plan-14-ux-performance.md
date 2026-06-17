# 子项目 14 — 效率与体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把 webmail 的「效率与体验」补齐到网易邮箱大师级——`GET /api/messages` 从 `.all()` 全量返回改为游标分页（10 万封不 OOM、首屏 <1.5s）、better-sqlite3 重查询用 worker_threads 隔离事件循环、邮件列表虚拟滚动（react-window，单文件夹 10 万+ 不卡）、完整快捷键体系（可自定义 + 冲突检测 + 帮助浮层 + 焦点管理）、响应式移动端（断点 + 抽屉 + 触摸手势）、PWA 可安装 + 离线缓存、暗色主题切换、无障碍（字体缩放/键盘可达/aria）。

**Architecture:** 方案 B（详见 spec §0/子项目 14/NFR 性能·并发·无障碍/风险登记册"性能与并发"）。本地单机、单进程、单 SQLite(WAL)、单用户不变。本计划在前端体验与 API 吞吐上做收敛：

1. **游标分页（关键性能修复）**：`GET /api/messages` 当前 `db.select().all()` 把整个文件夹一次性塞进响应——10 万封直接 OOM + 首屏数秒。改为基于 `(received_at, id)` **复合游标**的分页：客户端传 `?cursor=&limit=`（cursor 不透明 token，编码 `${received_at}_${id}`），服务端 WHERE `(received_at < :rt OR (received_at = :rt AND id < :id)) AND <筛选>` ORDER BY `received_at DESC, id DESC` LIMIT :limit，返回 `nextCursor`（最后一行算出，无更多为 null）。`received_at` 在 drizzle 里是 `timestamp` mode（存 epoch **秒**），故 cursor 用原始列值（秒）+ id。列表/未读数解耦：未读总数走单独的 `count(*)` 轻查询（已有），列表不附带全量。
2. **better-sqlite3 阻塞隔离**：better-sqlite3 是同步 API，一条慢查询/大事务会把整个 Next.js 事件循环卡住（IDLE/SSE/其他请求全停）。重查询（大范围扫描、回填、批量 FTS5 重建、跨文件夹聚合计数）下沉到 `worker_threads`：主线程把 SQL + params 投递给 worker，worker 跑完 postMessage 回结果；worker 池单例（local 单机 1 个 worker 足够），连接同一 `data/actbox.db`（WAL 多读单写安全）。
3. **虚拟滚动**：邮件列表用 `react-window` 的 `FixedSizeList`——只渲染可视区 + 上下 buffer 的行（约 30 行），单文件夹 10 万+ 行滚动 60fps。配合游标分页：首屏 1 页（limit=50），滚到底预取下一页（IntersectionObserver / onItemsRendered 回调触发 `fetchMessages(cursor)`）。
4. **快捷键 + 焦点管理**：`useHotkeys` hook（绑定 j/k/r/c/e/#/s// 等 + 可自定义映射 + 冲突检测），帮助浮层 `?` 唤起；list↔detail↔compose 三区焦点 trap（Tab/Shift+Tab 不逃逸、Esc 退出 compose）。
5. **响应式/移动端**：三栏布局加断点（md+ 三栏 / sm 单栏 + 抽屉导航）；列表行触摸手势（左滑归档、右滑标星/删除）。
6. **PWA**：`app/manifest.ts`（Next 16 内置 manifest 约定，见 `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`）+ `public/sw.js`（Service Worker，缓存壳页 + 最近邮件、断网回放 outbox 挂 `sync` 事件——与 plan-13 outbox 衔接）+ `next.config.ts` headers（sw.js 的 CSP/Cache-Control）。
7. **暗色主题**：theme provider（`data-theme` on `<html>` + CSS 变量 + `localStorage` 持久 + `prefers-color-scheme` 默认）+ 切换开关（现有 `bg-sidebar` 是暗色意图但无 toggle）。
8. **无障碍**：字体缩放（`html { font-size }` 可调，rem 基准）、键盘可达（所有交互元素 `:focus-visible`）、aria 标注（list/listitem/toolbar/dialog）、`aria-live="polite"` 区播报新邮件通知（与 plan-06 SSE 衔接）。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / react-window / better-sqlite3 + worker_threads / DOMPurify（已在 plan-11）/ vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 3（文件夹/列表数据视图稳定：`messages` 有 `account_id/folder/received_at`，列表筛选参数稳定）、子项目 8（批量：归档/删除/标记批量 API，快捷键 e/# 复用其批量端点）。阶段 4 执行——每任务先写失败测试再实现（TDD 先红后绿）。API route 测试对 `getDb()` 注入内存库（`memDb` helper，参考 plan-13 约定；若 plan-13 已建则复用并补本计划所需表，不重复建）。react-window / worker_threads 的 UI 与集成部分以单测覆盖纯逻辑（cursor 编解码、热键解析、冲突检测、worker 请求/响应）+ 手测覆盖视觉/交互（无法在 node 单测里跑真实 DOM 滚动/Service Worker）。

---

## 文件结构

- Modify: `src/app/api/messages/route.ts` — GET 改游标分页（`?cursor=&limit=`，复合游标 `(received_at, id)`，返回 `nextCursor`）（Task 1）
- Create: `src/lib/messages/cursor.ts` — `encodeCursor(rt, id)` / `decodeCursor(token)` / `parseListParams(req)` 纯函数（Task 1）
- Create: `src/lib/db/worker.ts` — `runInWorker(sql, params)`：worker_threads 封装（worker 池单例 + postMessage Promise 化 + 超时）（Task 2）
- Create: `src/lib/db/worker-script.ts` — worker 入口（`parentPort.on` → 打开 db → 跑 SQL → postMessage 回）（Task 2）
- Create: `src/components/mail/VirtualMessageList.tsx` — react-window `FixedSizeList` 封装（行渲染 + 滚到底预取下一页）（Task 3）
- Create: `src/components/mail/useMessagePages.ts` — 游标分页 hook（首屏 + loadMore(cursor) + 拼接，供虚拟列表喂全部已加载行）（Task 3）
- Create: `src/lib/hotkeys/registry.ts` — 快捷键定义表 + 默认映射 + `detectConflicts(map)` 冲突检测纯函数（Task 4）
- Create: `src/lib/hotkeys/parse.ts` — `parseBinding(s)` / `normalizeEvent(e)` / `match(binding, e)` 键序列匹配纯函数（Task 4）
- Create: `src/components/hotkeys/useHotkeys.ts` — 全局快捷键 hook（读 settings 自定义 + 冲突检测 + dispatch action）（Task 5）
- Create: `src/components/hotkeys/HotkeyHelpOverlay.tsx` — `?` 唤起的帮助浮层（列出所有绑定 + 冲突高亮）（Task 5）
- Create: `src/components/hotkeys/FocusTrap.tsx` — list↔detail↔compose 三区 focus trap（Task 5）
- Create: `src/components/theme/ThemeProvider.tsx` — theme provider（`data-theme` + localStorage + prefers-color-scheme）（Task 6）
- Create: `src/components/theme/ThemeToggle.tsx` — 暗色切换开关（Task 6）
- Modify: `src/app/layout.tsx` — 包 `ThemeProvider` + 注册 `sw.js` + `manifest` + `<html data-theme>`（Task 6 + Task 8）
- Modify: `src/app/globals.css` — 改 CSS 变量按 `[data-theme]` 切换（暗色 token 集）（Task 6）
- Create: `src/app/manifest.ts` — Next 16 web app manifest（Task 8）
- Create: `public/sw.js` — Service Worker（壳页缓存 + 最近邮件缓存 + fetch 降级 + sync 回放 outbox）（Task 8）
- Modify: `next.config.ts` — 加 `/sw.js` 与 manifest 的 headers（CSP / Cache-Control）（Task 8）
- Create: `src/components/mail/MobileDrawer.tsx` — 小屏抽屉导航 + 列表触摸手势（滑动归档/删除）（Task 7）
- Modify: `src/components/nav/AppShell.tsx` — 断点布局（md+ 三栏 / sm 单栏 + 抽屉）（Task 7）
- Create: `src/lib/a11y/font-scale.ts` — 字体缩放纯函数（`applyFontScale(level)` 写 `<html style>` + clamp）（Task 9）
- Modify: `src/components/EmailBody.tsx`、`src/app/mails/page.tsx` 等 — 补 aria 标注 + aria-live 新邮件区（Task 9）
- Create: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 全表建表（若 plan-13 已建则复用补本计划所需列/表）
- Test: `src/__tests__/messages/cursor.test.ts`、`src/__tests__/api/messages-pagination.test.ts`、`src/__tests__/db/worker.test.ts`、`src/__tests__/hotkeys/parse.test.ts`、`src/__tests__/hotkeys/registry.test.ts`、`src/__tests__/theme/provider.test.ts`、`src/__tests__/a11y/font-scale.test.ts`

---

## 任务

### Task 1: 游标分页（cursor 编解码纯函数 + GET /api/messages 改分页）

**Files:**
- Create: `src/lib/messages/cursor.ts`
- Create: `src/__tests__/messages/cursor.test.ts`
- Modify: `src/app/api/messages/route.ts`
- Create: `src/__tests__/api/messages-pagination.test.ts`

**关键设计：**
- **复合游标 `(received_at, id)`**：`received_at` 在 drizzle `timestamp` mode 下存 **epoch 秒**（见 `src/lib/db/schema.ts` line 31）。同一秒可能有多封邮件到达，故用 `id` 作 tie-break。游标 token = `base64url("${received_at}.${${id}}")`（不透明，客户端只原样回传）。
- **分页查询**：降序（新→旧）。
  ```sql
  SELECT id, message_id, subject, sender, recipient, body, body_html,
         received_at, direction, is_read, is_starred, todo_count
  FROM messages
  WHERE <筛选: direction/is_read/is_starred/like search>
    AND ( :cursor IS NULL
          OR (received_at < :rt OR (received_at = :rt AND id < :id)) )
  ORDER BY received_at DESC, id DESC
  LIMIT :limit
  ```
  `nextCursor` = 末行存在且行数 == limit 时算出（`encodeCursor(末行.received_at, 末行.id)`）；否则 null。
- **limit**：默认 50，clamp `[10, 200]`。
- **筛选不变**：保留现有 `direction`/`unread`/`starred`/`search` 语义，仅把 `.all()` 改 `LIMIT + cursor`。未读总数（`count(*)`）保留单独返回（轻查询，不分页）。
- **向后兼容**：客户端不传 `cursor`/`limit` 时按 limit=50 返回首页 + `nextCursor`（旧客户端拿 `messages` 数组仍可用，只是首屏少；plan-14 客户端 Task 3 改为消费 `nextCursor` 翻页）。
- **drizzle raw**：复合 cursor 的 `OR` 在 drizzle query builder 里啰嗦且易错，本计划直接用 `sql` 模板拼接参数化 raw SQL（防注入：cursor 解析出的 rt/id 一律 `Number()` 强制数值化，非数则 400）。

- [ ] **Step 1: 写 cursor 纯函数失败测试**

```ts
// src/__tests__/messages/cursor.test.ts
import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, clampLimit, DEFAULT_LIMIT } from '@/lib/messages/cursor'

describe('encodeCursor / decodeCursor', () => {
  it('往返一致', () => {
    const tok = encodeCursor(1_718_600_000, 42)
    const back = decodeCursor(tok)
    expect(back).toEqual({ receivedAt: 1_718_600_000, id: 42 })
  })
  it('不同 receivedAt/id 产生不同 token', () => {
    expect(encodeCursor(100, 1)).not.toBe(encodeCursor(100, 2))
    expect(encodeCursor(100, 1)).not.toBe(encodeCursor(101, 1))
  })
  it('decode 非法 token → null', () => {
    expect(decodeCursor('!!!notbase64!!!')).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })
  it('decode 格式错(缺 id) → null', () => {
    expect(decodeCursor(Buffer.from('100').toString('base64url'))).toBeNull()
  })
})

describe('clampLimit', () => {
  it('默认 50', () => { expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT) })
  it('范围内原样', () => { expect(clampLimit(30)).toBe(30) })
  it('过小 → 10', () => { expect(clampLimit(1)).toBe(10) })
  it('过大 → 200', () => { expect(clampLimit(99999)).toBe(200) })
  it('非数 → 默认', () => { expect(clampLimit(Number('abc'))).toBe(DEFAULT_LIMIT) })
})
```

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/messages/cursor.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/messages/cursor.ts`**

```ts
// src/lib/messages/cursor.ts
export const DEFAULT_LIMIT = 50
export const MIN_LIMIT = 10
export const MAX_LIMIT = 200

/** 把 (received_at[epoch秒], id) 编码为不透明游标 token(base64url)。 */
export function encodeCursor(receivedAt: number, id: number): string {
  return Buffer.from(`${receivedAt}.${id}`, 'utf8').toString('base64url')
}

/** 解码游标 token。非法返回 null(调用方按"无游标=首页"处理)。 */
export function decodeCursor(token: string | null | undefined): { receivedAt: number; id: number } | null {
  if (!token) return null
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const m = /^(\d+)\.(\d+)$/.exec(decoded)
    if (!m) return null
    return { receivedAt: Number(m[1]), id: Number(m[2]) }
  } catch {
    return null
  }
}

/** limit clamp 到 [MIN, MAX],默认 50。 */
export function clampLimit(raw: number | undefined): number {
  if (raw == null || Number.isNaN(raw)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(raw)))
}
```

- [ ] **Step 4: 写 API 分页失败测试**

```ts
// src/__tests__/api/messages-pagination.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db', () => { let c: any; return { getDb: () => c, __setDb: (d: any) => { c = d } } })
import { GET } from '@/app/api/messages/route'
import { memDb } from '../helpers/memDb'
import { encodeCursor } from '@/lib/messages/cursor'

describe('GET /api/messages 游标分页', () => {
  beforeEach(() => { const { db, raw } = memDb(); (require('@/lib/db') as any).__setDb(db); (globalThis as any).__raw = raw })

  function seed(n: number) {
    const raw = (globalThis as any).__raw
    const ins = raw.prepare("INSERT INTO messages (message_id, subject, sender, body, received_at, direction, is_read) VALUES (?,?,?,?,?,?,0)")
    // received_at 升序插入,靠后的更大(更新);同秒插多条验证 id tie-break
    for (let i = 1; i <= n; i++) ins.run(`m${i}@x`, `S${i}`, `f${i}@x`, `body${i}`, 1_700_000_000 + i)
  }

  it('默认 limit=50,返回首页 + nextCursor', async () => {
    seed(120)
    const res = await GET(new Request('http://x/api/messages?direction=in') as any)
    const j = await res.json()
    expect(j.messages).toHaveLength(50)
    expect(j.nextCursor).toBeTruthy()
    // 降序:最新(received_at 最大)在首
    expect(j.messages[0].subject).toBe('S120')
  })

  it('传 cursor 取下一页,且不重叠', async () => {
    seed(120)
    const p1 = await (await GET(new Request('http://x/api/messages?direction=in&limit=50') as any)).json()
    const p2 = await (await GET(new Request(`http://x/api/messages?direction=in&limit=50&cursor=${p1.nextCursor}`) as any)).json()
    const ids1 = new Set(p1.messages.map((m: any) => m.id))
    expect(p2.messages.every((m: any) => !ids1.has(m.id))).toBe(true)
    // p2 第一条比 p1 最后一条更旧
    expect(p2.messages[0].receivedAt).toBeLessThanOrEqual(p1.messages.at(-1).receivedAt)
  })

  it('末页 nextCursor=null', async () => {
    seed(120)
    let cursor: string | null = null
    let last
    for (let i = 0; i < 5; i++) { // 120/50 = 3 页
      const url = `http://x/api/messages?direction=in&limit=50${cursor ? `&cursor=${cursor}` : ''}`
      last = await (await GET(new Request(url) as any)).json()
      cursor = last.nextCursor
      if (!cursor) break
    }
    expect(last.messages.length).toBeLessThanOrEqual(50)
    expect(last.nextCursor).toBeNull()
  })

  it('cursor 与筛选叠加(unread)', async () => {
    const raw = (globalThis as any).__raw
    const ins = raw.prepare("INSERT INTO messages (message_id, subject, sender, received_at, direction, is_read) VALUES (?,?,?,?,?,?)")
    for (let i = 1; i <= 80; i++) ins.run(`m${i}`, `S${i}`, `f${i}`, 1_700_000_000 + i, 'in', i % 2) // 一半未读
    const p1 = await (await GET(new Request('http://x/api/messages?direction=in&unread=true&limit=10') as any)).json()
    expect(p1.messages.every((m: any) => !m.is_read)).toBe(true)
    expect(p1.messages).toHaveLength(10)
    expect(p1.nextCursor).toBeTruthy()
  })

  it('非法 cursor → 400', async () => {
    seed(5)
    const res = await GET(new Request('http://x/api/messages?cursor=!!!bad') as any)
    expect(res.status).toBe(400)
  })

  it('未读总数仍返回(不分页)', async () => {
    seed(3); const raw = (globalThis as any).__raw
    raw.prepare("UPDATE messages SET is_read=0 WHERE id<=2").run()
    const j = await (await GET(new Request('http://x/api/messages?direction=in') as any)).json()
    expect(j.unreadCount).toBe(2)
  })
})
```

- [ ] **Step 5: 运行确认失败** → FAIL（route 还在 `.all()`，无 `nextCursor`）。

- [ ] **Step 6: 改造 `src/app/api/messages/route.ts`**（保留筛选语义，去 `.all()`，加分页 + cursor）

```ts
// src/app/api/messages/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema'
import { eq, and, or, like, not, sql, desc } from 'drizzle-orm'
import { decodeCursor, clampLimit, encodeCursor } from '@/lib/messages/cursor'

export async function GET(request: NextRequest) {
  try {
    const db = getDb() as any
    const sp = new URL(request.url).searchParams

    // —— limit / cursor ——
    const limit = clampLimit(sp.get('limit') ? Number(sp.get('limit')) : undefined)
    const cursorTok = sp.get('cursor')
    if (cursorTok !== null) {
      // 显式传了 cursor 但非法 → 400(而非静默回首页,便于客户端发现 bug)
      if (cursorTok === '' || decodeCursor(cursorTok) === null) {
        return NextResponse.json({ error: 'invalid cursor' }, { status: 400 })
      }
    }
    const cursor = cursorTok ? decodeCursor(cursorTok) : null

    // —— 筛选条件 ——
    const direction = sp.get('direction') || 'in'
    const search = sp.get('search')
    const starred = sp.get('starred') === 'true'
    const unread = sp.get('unread') === 'true'

    const where: string[] = ["is_deleted = 0"]
    if (direction === 'in') where.push("direction = 'in'")
    else if (direction === 'out') where.push("direction = 'out'")
    else if (direction === 'draft') where.push("direction = 'draft'")
    if (unread) where.push('is_read = 0')
    if (starred) where.push('is_starred = 1')
    const params: any[] = []
    if (search) {
      where.push('(subject LIKE ? OR sender LIKE ? OR body LIKE ?)')
      const kw = `%${search}%`
      params.push(kw, kw, kw)
    }

    // —— 复合游标 ——
    if (cursor) {
      where.push('(received_at < ? OR (received_at = ? AND id < ?))')
      params.push(cursor.receivedAt, cursor.receivedAt, cursor.id)
    }

    const whereSql = where.join(' AND ')
    params.push(limit + 1) // 多取 1 行判断是否有下一页

    const rows = db.prepare(
      `SELECT id, message_id, subject, sender, recipient, body, body_html,
              received_at, direction, is_read, is_starred, todo_count
       FROM messages WHERE ${whereSql}
       ORDER BY received_at DESC, id DESC LIMIT ?`
    ).all(...params) as any[]

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(Number(page[page.length - 1].received_at), Number(page[page.length - 1].id))
      : null

    // —— 未读总数(不分页,轻查询) ——
    const unreadRow = db.prepare(
      "SELECT count(*) c FROM messages WHERE direction='in' AND is_read=0 AND is_deleted=0"
    ).get() as any

    return NextResponse.json({
      messages: page,
      nextCursor,
      unreadCount: unreadRow?.c || 0,
    })
  } catch (error) {
    console.error('[/api/messages GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
```

> 注：`received_at` 列原值为 epoch 秒（drizzle timestamp mode），直接 Number() 取即可；返回给前端的 `receivedAt` 经 drizzle 不再序列化（本查询走裸 `db.prepare` 返回原列值），前端 `new Date(row.receivedAt * 1000)` 或由前端格式化层处理（现有 `mails/page.tsx` 的 `new Date(dateStr)` 需配套 `*1000`，Task 3 接虚拟列表时一并修；当前测试断言用数值比较，不依赖序列化格式）。若现有前端依赖 drizzle 的 ISO 字符串，则在 SELECT 后对每行 `received_at` 不做转换保持原样（秒），由消费方处理——以 `messages-pagination.test.ts` 断言为准。

- [ ] **Step 7: 运行确认通过** → PASS。`npx vitest run src/__tests__/messages/ src/__tests__/api/messages-pagination.test.ts`。

- [ ] **Step 8: 回归** `npx vitest run`（确保未破坏现有 messages 相关测试，若现有测试断言一次性返回全部需同步改成断言首页 + nextCursor）。`npx tsc --noEmit` → 无错误。

- [ ] **Step 9: Commit**

```bash
git add src/lib/messages/cursor.ts src/__tests__/messages/cursor.test.ts src/app/api/messages/route.ts src/__tests__/api/messages-pagination.test.ts
git commit -m "perf(api): cursor pagination for GET /api/messages (composite (received_at,id) cursor, no .all())"
git push
```

---

### Task 2: better-sqlite3 worker_threads 隔离封装

**Files:**
- Create: `src/lib/db/worker-script.ts`
- Create: `src/lib/db/worker.ts`
- Create: `src/__tests__/db/worker.test.ts`

**关键设计：** better-sqlite3 同步 API 在事件循环里跑长查询会阻塞 IDLE/SSE/其他请求。把「重查询」（大范围扫描、回填、批量重建、跨文件夹聚合）下沉到 worker_threads。
- **worker-script.ts**（worker 入口，`new Worker(__filename)` 自引用）：`parentPort.on('message', { id, dbPath, sql, params })` → 打开/复用 better-sqlite3（WAL）→ `prepare(sql).all(...params)`（或 `.run`）→ `postMessage({ id, ok: true, rows })`；异常 `postMessage({ id, ok: false, error })`。db 实例在 worker 内常驻复用（同一 dbPath）。
- **worker.ts**（主线程 API）：`runInWorker({ dbPath, sql, params, timeoutMs })` → 返回 Promise；worker 池**单例**（local 单机 1 个 worker 足够）；超时 `timeoutMs`（默认 10s）未回则 reject + 不杀 worker（下条复用）；worker 闲置常驻。
- **安全**：只接受**白名单式**的 SQL 调用方（内部模块），不暴露为任意 SQL 端点（本计划无新公开路由，仅内部 `runInWorker`）。
- **WAL 多读安全**：主线程写、worker 读，WAL 模式下多读单写安全（spec §0）；worker 只跑只读查询（`SELECT`）—— `runInWorker` 内 `assert(/^\s*select/i.test(sql))`，拒绝写语句（写仍走主线程同步，事务短小）。

- [ ] **Step 1: 写失败测试**

```ts
// src/__tests__/db/worker.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { runInWorker } from '@/lib/db/worker'

const DB_PATH = '/tmp/actbox-worker-test.db'
let raw: Database.Database

beforeAll(() => {
  raw = new Database(DB_PATH)
  raw.pragma('journal_mode = WAL')
  raw.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, received_at INTEGER)')
  raw.prepare('DELETE FROM messages').run()
  for (let i = 0; i < 1000; i++) raw.prepare('INSERT INTO messages (subject, received_at) VALUES (?,?)').run(`s${i}`, i)
})
afterAll(() => { try { raw.close() } catch {} /* worker 内连接自行关闭 */ })

describe('runInWorker', () => {
  it('只读查询返回结果', async () => {
    const r = await runInWorker({ dbPath: DB_PATH, sql: 'SELECT count(*) c FROM messages', params: [] })
    expect(r.ok).toBe(true)
    expect((r as any).rows[0].c).toBe(1000)
  })
  it('带 params 查询', async () => {
    const r = await runInWorker({ dbPath: DB_PATH, sql: 'SELECT subject FROM messages WHERE received_at > ? ORDER BY received_at LIMIT 1', params: [998] })
    expect((r as any).rows[0].subject).toBe('s999')
  })
  it('拒绝写语句 → ok:false', async () => {
    const r = await runInWorker({ dbPath: DB_PATH, sql: 'DELETE FROM messages WHERE 1=1', params: [] })
    expect(r.ok).toBe(false)
    expect((r as any).error).toMatch(/read.only|select/i)
  })
  it('SQL 报错 → ok:false 带 error', async () => {
    const r = await runInWorker({ dbPath: DB_PATH, sql: 'SELECT * FROM nope', params: [] })
    expect(r.ok).toBe(false)
  })
  it('超时 → reject', async () => {
    await expect(
      runInWorker({ dbPath: DB_PATH, sql: 'SELECT count(*) c FROM messages', params: [], timeoutMs: 1 })
    ).rejects.toThrow(/timeout/i)
  }, 15000)
})
```

> 注：超时测试用极小 timeoutMs 触发；worker 启动 + db 打开有固有延迟，1ms 必超时。若 CI 机慢导致首条也超时，把该用例 timeoutMs 调 1 不变、vitest timeout 放宽到 15s（已设）。worker 单例在模块加载时即起，跨用例复用。

- [ ] **Step 2: 运行确认失败** `npx vitest run src/__tests__/db/worker.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/db/worker-script.ts`**（worker 入口，自引用 `new Worker(__filename)`）

```ts
// src/lib/db/worker-script.ts
// 注意:本文件被 `new Worker(new URL('./worker-script.ts', import.meta.url))` 加载。
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'

const dbs = new Map<string, Database.Database>()

function getDb(dbPath: string): Database.Database {
  let db = dbs.get(dbPath)
  if (!db) {
    db = new Database(dbPath, { readonly: true })
    db.pragma('journal_mode = WAL')
    dbs.set(dbPath, db)
  }
  return db
}

interface Req { id: number; dbPath: string; sql: string; params: any[] }

parentPort?.on('message', (req: Req) => {
  try {
    // 只读白名单:仅允许 SELECT;防止 worker 被用来写(写仍走主线程同步事务)
    if (!/^\s*select/i.test(req.sql.trim())) {
      parentPort!.postMessage({ id: req.id, ok: false, error: 'worker is read-only: only SELECT allowed' })
      return
    }
    const db = getDb(req.dbPath)
    const trimmed = req.sql.trim().toLowerCase()
    let rows: any
    if (/^\s*select/.test(req.sql.trim())) {
      rows = db.prepare(req.sql).all(...req.params)
    } else {
      rows = db.prepare(req.sql).run(...req.params)
    }
    parentPort!.postMessage({ id: req.id, ok: true, rows })
  } catch (e: any) {
    parentPort!.postMessage({ id: req.id, ok: false, error: e?.message || String(e) })
  }
})

parentPort?.postMessage({ id: -1, ok: true, rows: [], ready: true })
```

- [ ] **Step 4: 实现 `src/lib/db/worker.ts`**（主线程封装）

```ts
// src/lib/db/worker.ts
import { Worker } from 'worker_threads'
import path from 'path'

export interface RunInWorkerOpts {
  dbPath: string
  sql: string
  params?: any[]
  timeoutMs?: number
}
export interface WorkerOk { id: number; ok: true; rows: any[] }
export interface WorkerErr { id: number; ok: false; error: string }

let worker: Worker | null = null
let ready = false
let seq = 0
const pending = new Map<number, { resolve: (v: WorkerOk | WorkerErr) => void; timer: NodeJS.Timeout }>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(path.join(__dirname, 'worker-script.js'), { /* 由 ts 编译后路径 */ })
  worker.on('message', (msg: WorkerOk | WorkerErr) => {
    if ((msg as any).ready) { ready = true; return }
    const p = pending.get(msg.id)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(msg.id)
      p.resolve(msg)
    }
  })
  worker.on('error', (e) => {
    // worker 崩了:reject 所有 pending,重建由下次 ensureWorker 触发
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ id: -1, ok: false, error: `worker crashed: ${e.message}` }) }
    pending.clear()
    worker = null; ready = false
  })
  return worker
}

/** 在 worker_threads 里跑只读 SELECT,隔离事件循环。超时 reject(不杀 worker,复用)。 */
export function runInWorker(opts: RunInWorkerOpts): Promise<WorkerOk | WorkerErr> {
  const w = ensureWorker()
  const id = ++seq
  const timeoutMs = opts.timeoutMs ?? 10_000
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ id, ok: false, error: `timeout after ${timeoutMs}ms` })
      // 注意:不 terminate worker(超时可能是查询慢,worker 仍在跑完会 postMessage,pending 已清,丢弃)
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    w.postMessage({ id, dbPath: opts.dbPath, sql: opts.sql, params: opts.params ?? [] })
  })
}

/** 进程退出时清理(测试用)。 */
export async function disposeWorker(): Promise<void> {
  if (worker) { await worker.terminate(); worker = null; ready = false }
}
```

> 注：`new Worker(path.join(__dirname, 'worker-script.js'))` 指向编译后 JS；vitest 跑 TS 时若直接 import 源 TS，需保证 worker 脚本也能被 worker 线程加载——实践中 Next dev/server 经由 node 跑编译产物，本计划测试用例在 node 下经 vitest，`__dirname` 指向 `dist` 或 `src`。若 vitest 下 `__dirname` 指向 `src/lib/db`，则 Worker 路径用 `new URL('./worker-script.ts', import.meta.url)` 让 vitest/ts-node 解析 TS 源。**实现时**优先用 `new Worker(new URL('./worker-script.ts', import.meta.url))`（Node 18+ 支持 TS worker 文件经 `--experimental-strip-types` 或 tsx），若环境不支持则回退 `worker-script.js`（编译产物）。以 `worker.test.ts` 全绿为最终判据。

- [ ] **Step 5: 运行确认通过** → PASS。`npx vitest run src/__tests__/db/worker.test.ts`。`npx tsc --noEmit` → 无错误（worker_threads / better-sqlite3 类型已装 `@types/better-sqlite3`、`@types/node`）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/worker-script.ts src/lib/db/worker.ts src/__tests__/db/worker.test.ts
git commit -m "perf(db): worker_threads isolation for heavy read-only SELECT (event-loop non-blocking)"
git push
```

---

### Task 3: 虚拟滚动（react-window 列表 + 游标分页 hook）

**Files:**
- Create: `src/components/mail/useMessagePages.ts`
- Create: `src/components/mail/VirtualMessageList.tsx`
- Modify: `src/app/mails/page.tsx`

**关键设计：**
- **`useMessagePages(folder, search)`**：游标分页 hook。state `items: Message[]`、`cursor: string|null`、`loading`、`hasMore`。`loadMore()`：若 `!hasMore || loading` return；fetch `?...&cursor=${cursor}&limit=50` → 拼接 `items`、更新 `cursor=nextCursor`、`hasMore = nextCursor != null`。folder/search 变化 → reset + 首屏 loadMore。`reload()`：全 reset 重取（标记已读后刷未读文件夹用）。
- **`VirtualMessageList`**：`react-window` `FixedSizeList`（行高固定 ~76px），`itemCount={items.length}`，`onItemsRendered`：当 `visibleStopIndex >= items.length - 10`（滚到接近底）触发 `loadMore()`。行组件从 `items[index]` 取渲染（复用现有行 UI：头像/发件人/主题/预览/星标/待办角标）。`FixedSizeList` 的 `ref` 暴露 `scrollToItem` 供快捷键 j/k 移动选中行后滚动到可视。
- **receivedAt 时间格式修正**：游标分页后行数据 `received_at` 为 epoch 秒（裸 SELECT），行组件 `formatDate` 用 `new Date(sec * 1000)`。
- **空/加载态**：`items.length===0 && !loading` → 空状态；`loading && items.length===0` → 骨架屏。

- [ ] **Step 1: 安装 react-window** `npm i react-window @types/react-window`（若无 `@types` 则 `npm i -D @types/react-window`）。

- [ ] **Step 2: 实现 `useMessagePages.ts`**（hook，逻辑层；纯逻辑部分抽 `buildMessagesUrl(folder, search, cursor)` 便于单测）

```ts
// src/components/mail/useMessagePages.ts
import { useState, useEffect, useCallback, useRef } from 'react'

export interface MessageRow {
  id: number; messageId: string; subject: string | null; from: string | null
  to: string | null; body: string | null; bodyHtml: string | null
  receivedAt: number | null; direction: string; isRead: number; isStarred: number; todoCount: number
}

/** 由 folder/search/cursor 构造 /api/messages 的 query string(纯函数,可单测)。 */
export function buildMessagesUrl(folder: string, search: string, cursor: string | null, limit = 50): string {
  const p = new URLSearchParams()
  if (folder === 'drafts') p.set('direction', 'draft')
  else if (folder === 'sent') p.set('direction', 'out')
  else {
    p.set('direction', 'in')
    if (folder === 'unread') p.set('unread', 'true')
    if (folder === 'starred') p.set('starred', 'true')
  }
  if (search) p.set('search', search)
  p.set('limit', String(limit))
  if (cursor) p.set('cursor', cursor)
  return `/api/messages?${p.toString()}`
}

export function useMessagePages(folder: string, search: string) {
  const [items, setItems] = useState<MessageRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursor

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const res = await fetch(buildMessagesUrl(folder, search, cursorRef.current))
      const data = await res.json()
      if (!res.ok) return
      setItems((prev) => [...prev, ...(data.messages || [])])
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor != null)
    } finally {
      setLoading(false)
    }
  }, [folder, search, loading, hasMore])

  const reload = useCallback(async () => {
    setItems([]); setCursor(null); setHasMore(true); cursorRef.current = null
    // reset 后立即取首页
    setLoading(true)
    try {
      const res = await fetch(buildMessagesUrl(folder, search, null))
      const data = await res.json()
      if (res.ok) { setItems(data.messages || []); setCursor(data.nextCursor); setHasMore(data.nextCursor != null) }
    } finally { setLoading(false) }
  }, [folder, search])

  useEffect(() => { reload() }, [reload]) // folder/search 变 → reset 重取

  return { items, loading, hasMore, loadMore, reload }
}
```

- [ ] **Step 3: 写 `buildMessagesUrl` 单测**（纯函数可单测）

```ts
// src/__tests__/messages/pages.test.ts
import { describe, it, expect } from 'vitest'
import { buildMessagesUrl } from '@/components/mail/useMessagePages'

describe('buildMessagesUrl', () => {
  it('inbox 首页', () => {
    expect(buildMessagesUrl('inbox', '', null)).toContain('direction=in')
    expect(buildMessagesUrl('inbox', '', null)).toContain('limit=50')
    expect(buildMessagesUrl('inbox', '', null)).not.toContain('cursor=')
  })
  it('unread 带 unread=true', () => {
    expect(buildMessagesUrl('unread', '', null)).toContain('unread=true')
  })
  it('带 search + cursor', () => {
    const u = buildMessagesUrl('inbox', '发票', 'abc')
    expect(u).toContain('search=%E5%8F%91%E7%A5%A8')
    expect(u).toContain('cursor=abc')
  })
  it('drafts/sent 方向', () => {
    expect(buildMessagesUrl('drafts', '', null)).toContain('direction=draft')
    expect(buildMessagesUrl('sent', '', null)).toContain('direction=out')
  })
})
```

- [ ] **Step 4: 实现 `VirtualMessageList.tsx`**（react-window 封装 + onItemsRendered 预取 + scrollToItem）

```tsx
// src/components/mail/VirtualMessageList.tsx
'use client'
import { useRef, useCallback, type ReactElement } from 'react'
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window'
import type { MessageRow } from './useMessagePages'

const ROW_HEIGHT = 76

interface Props {
  items: MessageRow[]
  selectedId: number | null
  onSelect: (m: MessageRow) => void
  onToggleStar: (id: number, starred: number) => void
  loadMore: () => void
}

export function VirtualMessageList({ items, selectedId, onSelect, onToggleStar, loadMore }: Props) {
  const listRef = useRef<List>(null)

  const onItemsRendered = useCallback(({ visibleStopIndex }: { visibleStopIndex: number }) => {
    if (visibleStopIndex >= items.length - 10) loadMore()
  }, [items.length, loadMore])

  const Row = ({ index, style }: ListChildComponentProps): ReactElement => {
    const msg = items[index]
    if (!msg) return <div style={style} />
    return (
      <div
        style={style}
        role="listitem"
        aria-current={selectedId === msg.id}
        onClick={() => onSelect(msg)}
        className={`flex cursor-pointer gap-3 border-b border-border/50 px-4 transition-colors hover:bg-accent/50 ${selectedId === msg.id ? 'bg-accent' : ''} ${!msg.isRead ? 'bg-primary/5' : ''}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full bg-blue-500 text-xs font-bold text-white">
          {(msg.from || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 self-center">
          <div className="flex items-center justify-between gap-2">
            <p className={`truncate text-sm ${!msg.isRead ? 'font-bold' : 'text-muted-foreground'}`}>{msg.from || '未知'}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {msg.receivedAt ? new Date(msg.receivedAt * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' }) : ''}
            </span>
          </div>
          <p className={`truncate text-sm ${!msg.isRead ? 'font-semibold' : 'text-muted-foreground'}`}>{msg.subject || '(无主题)'}</p>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">{msg.body?.substring(0, 60) || '(无预览)'}</p>
            <button onClick={(e) => { e.stopPropagation(); onToggleStar(msg.id, msg.isStarred) }} className="text-xs" aria-label="标星">
              {msg.isStarred ? '⭐' : '☆'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <List
      ref={listRef}
      height={600 /* 由父容器 flex 撑满;此处给默认高度,实际用 AutoSizer 或父 100% */}
      itemCount={items.length}
      itemSize={ROW_HEIGHT}
      width="100%"
      onItemsRendered={onItemsRendered}
      role="list"
      aria-label="邮件列表"
    >
      {Row}
    </List>
  )
}

export function scrollToItem(listRef: React.RefObject<List>, index: number) {
  listRef.current?.scrollToItem(index, 'auto')
}
```

> 注：`List` 的 height 固定 600 仅兜底；实际嵌入 `mails/page.tsx` 时用父容器测量（`react-window` 推荐 `react-virtualized-auto-sizer` 或 `useElementSize`）。本计划为避免新依赖，在 `mails/page.tsx` 用 `ResizeObserver`/CSS `height:100%` + `AutoSizer`-free 写法：父 `div` 给确定 flex 高度，`List height={containerHeight}`，containerHeight 由 `useEffect(ResizeObserver)` 取。**实现时**若 600 兜底导致测试不便，引入 `react-virtualized-auto-sizer`（小依赖，~1KB）填满——以手测列表正常滚动为判据。

- [ ] **Step 5: 接入 `src/app/mails/page.tsx`**：把现有 `messages.map(...)` 替换为 `<VirtualMessageList items={items} ... />`，把现有 `fetchMessages` 替换为 `useMessagePages(folder, search)` 返回的 `{ items, loadMore, reload }`；选中后乐观标已读调 `reload`（若在 unread 文件夹）。`formatDate` 改 `new Date(sec*1000)`。

- [ ] **Step 6: 运行确认通过** `npx vitest run src/__tests__/messages/` → PASS。`npx tsc --noEmit` → 无错误（react-window 类型）。

- [ ] **Step 7: 手测**：列表正常渲染 + 滚动到底预取下一页（Network 可见 `?cursor=` 请求）+ 单文件夹 1000+ 行滚动流畅（无卡顿）；空状态/加载骨架正常。

- [ ] **Step 8: Commit**

```bash
git add src/components/mail/useMessagePages.ts src/components/mail/VirtualMessageList.tsx src/app/mails/page.tsx src/__tests__/messages/pages.test.ts package.json package-lock.json
git commit -m "perf(ui): virtualized message list (react-window) + cursor pagination hook"
git push
```

---

### Task 4: 快捷键体系 — 解析 + 注册表 + 冲突检测（纯函数）

**Files:**
- Create: `src/lib/hotkeys/parse.ts`
- Create: `src/lib/hotkeys/registry.ts`
- Create: `src/__tests__/hotkeys/parse.test.ts`
- Create: `src/__tests__/hotkeys/registry.test.ts`

**关键设计：**
- **`parse.ts`**：
  - `parseBinding(s)`：把 `"mod+k"` / `"shift+/?"` / `"#"` 解析为 `{ ctrl|cmd(meta) , shift, alt, key }` 规范化结构。`mod` = macOS 下 `meta`(⌘)、其他 `control`。key 统一小写；单字符 `?`/`/`/`#` 直接 key。返回 `{ mod, shift, alt, key }` 或抛错（空/非法）。
  - `normalizeEvent(e: KeyboardEvent)`：`{ mod: e.metaKey||e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key.toLowerCase() }`。
  - `match(binding, eventNorm)`：四元组精确相等（含 key；`mod` 视 meta||ctrl）。
- **`registry.ts`**：
  - `DEFAULT_BINDINGS`：`{ 'next': 'j', 'prev': 'k', 'reply': 'r', 'compose': 'c', 'archive': 'e', 'delete': '#', 'star': 's', 'search': '/', 'help': '?' }`。
  - `detectConflicts(bindings)`：返回冲突列表（两个 action 绑定到同一四元组）。同一 action 不同绑定不算冲突。
  - `resolveBindings(custom)`：合并默认 + 自定义（custom 覆盖 default）；custom 里某 action 设 `null` 表示禁用。
  - `formatBinding(binding)`：人读串（`Cmd+K` / `?`）供帮助浮层。

- [ ] **Step 1: 写 parse 失败测试**

```ts
// src/__tests__/hotkeys/parse.test.ts
import { describe, it, expect } from 'vitest'
import { parseBinding, normalizeEvent, match, formatBinding } from '@/lib/hotkeys/parse'

describe('parseBinding', () => {
  it('单字符', () => {
    expect(parseBinding('j')).toEqual({ mod: false, shift: false, alt: false, key: 'j' })
  })
  it('mod+k', () => {
    expect(parseBinding('mod+k')).toEqual({ mod: true, shift: false, alt: false, key: 'k' })
  })
  it('shift+/ 与 / 等价?key 为 /', () => {
    expect(parseBinding('/')).toEqual({ mod: false, shift: false, alt: false, key: '/' })
    expect(parseBinding('shift+/').key).toBe('/')
  })
  it('ctrl+shift+a', () => {
    expect(parseBinding('ctrl+shift+a')).toEqual({ mod: true, shift: true, alt: false, key: 'a' })
  })
  it('alt+#', () => {
    expect(parseBinding('alt+#')).toEqual({ mod: false, shift: false, alt: true, key: '#' })
  })
  it('大小写不敏感 + trim', () => {
    expect(parseBinding('  Mod+K ')).toEqual({ mod: true, shift: false, alt: false, key: 'k' })
  })
  it('空串 → 抛错', () => {
    expect(() => parseBinding('')).toThrow()
    expect(() => parseBinding('   ')).toThrow()
  })
})

describe('normalizeEvent / match', () => {
  const ev = (k: string, mods: Partial<Pick<KeyboardEvent,'metaKey'|'ctrlKey'|'shiftKey'|'altKey'>>) =>
    normalizeEvent({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods } as any)
  it('match 精确', () => {
    expect(match(parseBinding('j'), ev('j', {}))).toBe(true)
    expect(match(parseBinding('mod+k'), ev('k', { metaKey: true }))).toBe(true)
    expect(match(parseBinding('mod+k'), ev('k', { ctrlKey: true }))).toBe(true) // ctrl 或 meta 都算 mod
    expect(match(parseBinding('j'), ev('j', { shiftKey: true }))).toBe(false) // 多按了 shift 不匹配
  })
  it('不匹配 key', () => {
    expect(match(parseBinding('j'), ev('k', {}))).toBe(false)
  })
})

describe('formatBinding', () => {
  it('人读串', () => {
    expect(formatBinding(parseBinding('mod+k'))).toMatch(/(Cmd|Ctrl)\+K/i)
    expect(formatBinding(parseBinding('?'))).toBe('?')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/hotkeys/parse.ts`**

```ts
// src/lib/hotkeys/parse.ts
export interface Binding { mod: boolean; shift: boolean; alt: boolean; key: string }

export function parseBinding(s: string): Binding {
  const raw = (s || '').trim().toLowerCase()
  if (!raw) throw new Error(`empty binding`)
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean)
  let mod = false, shift = false, alt = false
  let key = ''
  for (const p of parts) {
    if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl' || p === 'control') mod = true
    else if (p === 'shift') shift = true
    else if (p === 'alt' || p === 'option') alt = true
    else key = p
  }
  if (!key) throw new Error(`binding has no key: ${s}`)
  // shift+/ 等价 /(美式键盘 ?=shift+/):统一为 /
  if (shift && key === '/') { key = '/'; /* shift 仍记,match 时纯 / 不带 shift 也算同键 */ }
  return { mod, shift, alt, key }
}

export interface NormEvent { mod: boolean; shift: boolean; alt: boolean; key: string }
export function normalizeEvent(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): NormEvent {
  return { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: (e.key || '').toLowerCase() }
}

export function match(b: Binding, e: NormEvent): boolean {
  // key 严格;mod 接受 meta||ctrl;alt 严格。
  // shift:若 binding 声明 shift 则必须 shift;若 binding 未声明 shift 但实际按了 shift,且 key 不是符号键,则视为不匹配(避免 j+shift 触发 j)
  if (b.key !== e.key) return false
  if (b.alt !== e.alt) return false
  if (b.mod !== e.mod) return false
  const symbolic = !/^[a-z0-9]$/.test(b.key)
  if (!symbolic && b.shift !== e.shift) return false
  return true
}

export function formatBinding(b: Binding): string {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')
  const modLabel = isMac ? 'Cmd' : 'Ctrl'
  const parts: string[] = []
  if (b.mod) parts.push(modLabel)
  if (b.shift) parts.push('Shift')
  if (b.alt) parts.push(isMac ? 'Option' : 'Alt')
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : b.key)
  return parts.join('+')
}
```

- [ ] **Step 4: 写 registry 失败测试**

```ts
// src/__tests__/hotkeys/registry.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_BINDINGS, resolveBindings, detectConflicts } from '@/lib/hotkeys/registry'

describe('resolveBindings', () => {
  it('默认全量', () => {
    const r = resolveBindings({})
    expect(r.next.key).toBe('j')
    expect(r.help.key).toBe('?')
  })
  it('custom 覆盖 default', () => {
    const r = resolveBindings({ next: 'n' })
    expect(r.next.key).toBe('n')
    expect(r.prev.key).toBe('k') // 未改的保留
  })
  it('custom null → 禁用(不在结果)', () => {
    const r = resolveBindings({ delete: null })
    expect(r.delete).toBeUndefined()
  })
})

describe('detectConflicts', () => {
  it('无冲突 → 空', () => {
    expect(detectConflicts(resolveBindings({}))).toEqual([])
  })
  it('两个 action 同键 → 冲突', () => {
    const r = resolveBindings({ reply: 'j' }) // reply 与 next 都 j
    const c = detectConflicts(r)
    expect(c.length).toBeGreaterThan(0)
    expect(c.some((x) => x.actions.includes('reply') && x.actions.includes('next'))).toBe(true)
  })
  it('冲突返回按键 + 涉及 actions', () => {
    const r = resolveBindings({ compose: 'j' })
    const c = detectConflicts(r)
    expect(c[0].key).toBe('j')
    expect(Array.isArray(c[0].actions)).toBe(true)
  })
})

describe('DEFAULT_BINDINGS 完整', () => {
  it('覆盖核心动作', () => {
    const keys = Object.keys(DEFAULT_BINDINGS)
    for (const a of ['next','prev','reply','compose','archive','delete','star','search','help']) {
      expect(keys).toContain(a)
    }
  })
})
```

- [ ] **Step 5: 运行确认失败** → FAIL。

- [ ] **Step 6: 实现 `src/lib/hotkeys/registry.ts`**

```ts
// src/lib/hotkeys/registry.ts
import { parseBinding, type Binding } from './parse'

export type Action =
  | 'next' | 'prev' | 'reply' | 'compose' | 'archive' | 'delete'
  | 'star' | 'search' | 'help' | 'markRead' | 'refresh'

export const DEFAULT_BINDINGS: Record<Action, string> = {
  next: 'j',
  prev: 'k',
  reply: 'r',
  compose: 'c',
  archive: 'e',
  delete: '#',
  star: 's',
  search: '/',
  help: '?',
  markRead: 'm',
  refresh: '.',
}

export type BindingMap = Partial<Record<Action, Binding>>

/** 合并默认 + 自定义(custom 覆盖;null=禁用,从结果剔除)。 */
export function resolveBindings(custom: Partial<Record<Action, string | null>>): BindingMap {
  const out: BindingMap = {}
  for (const [action, s] of Object.entries(DEFAULT_BINDINGS) as [Action, string][]) {
    out[action] = parseBinding(s)
  }
  for (const [action, s] of Object.entries(custom) as [Action, string | null][]) {
    if (s === null) delete out[action]
    else out[action] = parseBinding(s)
  }
  return out
}

export interface Conflict { key: string; mod: boolean; shift: boolean; alt: boolean; actions: Action[] }

/** 检测同一四元组被多个 action 绑定。 */
export function detectConflicts(map: BindingMap): Conflict[] {
  const groups = new Map<string, { b: Binding; actions: Action[] }>()
  for (const [action, b] of Object.entries(map) as [Action, Binding][]) {
    const k = `${b.mod}|${b.shift}|${b.alt}|${b.key}`
    const g = groups.get(k)
    if (g) g.actions.push(action)
    else groups.set(k, { b, actions: [action] })
  }
  return [...groups.values()].filter((g) => g.actions.length > 1).map((g) => ({ key: g.b.key, mod: g.b.mod, shift: g.b.shift, alt: g.b.alt, actions: g.actions }))
}
```

- [ ] **Step 7: 运行确认通过** → PASS。`npx vitest run src/__tests__/hotkeys/`。

- [ ] **Step 8: Commit**

```bash
git add src/lib/hotkeys/parse.ts src/lib/hotkeys/registry.ts src/__tests__/hotkeys/parse.test.ts src/__tests__/hotkeys/registry.test.ts
git commit -m "feat(hotkeys): binding parse/normalize/match + registry (defaults, resolve, conflict detection)"
git push
```

---

### Task 5: 快捷键 UI — useHotkeys hook + 帮助浮层 + 焦点 trap

**Files:**
- Create: `src/components/hotkeys/useHotkeys.ts`
- Create: `src/components/hotkeys/HotkeyHelpOverlay.tsx`
- Create: `src/components/hotkeys/FocusTrap.tsx`
- Modify: `src/app/mails/page.tsx`（接入 useHotkeys + FocusTrap + ? 浮层）

**关键设计：**
- **`useHotkeys(bindings, handlers, opts)`**：`useEffect` 注册全局 `keydown`：对每个 `[action, binding]` 用 `normalizeEvent` + `match` 命中 → 调 `handlers[action]`。`opts.enableWhen`（默认 input/textarea/contenteditable 聚焦时**禁用单字符快捷键** j/k/r/c/s/#/，但保留 mod+k 等——防打字误触；例外 `escape` 永远可用）。可选 `opts.scope`（'list'|'detail'|'compose'）决定当前激活区。
- **`HotkeyHelpOverlay`**：`?` 触发（或 toolbar 按钮）；`role="dialog" aria-modal`；列出所有 action → formatBinding；`detectConflicts` 命中的行高亮红 + 提示；Esc 关闭。从 settings 读自定义绑定（`hotkeys.bindings` JSON）。
- **`FocusTrap`**：`role="group"` 容器；Tab/Shift+Tab 在容器内可聚焦元素间循环（拦截首/末元素的 Tab）；Esc 退出（调 `onEscape`）；自动聚焦容器首个可聚焦元素。list/detail/compose 三区各包一个，实现 list↔detail↔compose 焦点切换（action handler 切 scope 时把焦点移到目标区）。

- [ ] **Step 1: 实现 `useHotkeys.ts`**（hook；纯逻辑抽 `shouldIgnore(e, binding)` 便于单测）

```ts
// src/components/hotkeys/useHotkeys.ts
import { useEffect, useCallback } from 'react'
import type { BindingMap, Action } from '@/lib/hotkeys/registry'
import { normalizeEvent, match, type Binding } from '@/lib/hotkeys/parse'

/** 输入框聚焦时是否忽略此 binding(单字符键忽略,mod 组合不忽略)。纯函数可单测。 */
export function shouldIgnore(target: EventTarget | null, b: Binding): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  if (!editable) return false
  // 在输入框内:仅放行带 mod 的组合键,单字符一律忽略
  return !b.mod
}

export interface UseHotkeysOpts { enabled?: boolean }

export function useHotkeys(bindings: BindingMap, handlers: Partial<Record<Action, (e: KeyboardEvent) => void>>, opts: UseHotkeysOpts = {}) {
  const onKey = useCallback((e: KeyboardEvent) => {
    if (opts.enabled === false) return
    const norm = normalizeEvent(e)
    for (const action of Object.keys(bindings) as Action[]) {
      const b = bindings[action]
      if (!b) continue
      if (shouldIgnore(e.target, b)) continue
      if (match(b, norm)) {
        const h = handlers[action]
        if (h) { e.preventDefault(); h(e); return }
      }
    }
  }, [bindings, handlers, opts.enabled])

  useEffect(() => {
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any)
  }, [onKey])
}
```

- [ ] **Step 2: 写 `shouldIgnore` 单测**

```ts
// src/__tests__/hotkeys/useHotkeys.test.ts
import { describe, it, expect } from 'vitest'
import { shouldIgnore } from '@/components/hotkeys/useHotkeys'
import { parseBinding } from '@/lib/hotkeys/parse'

const inputEl = () => ({ tagName: 'INPUT', isContentEditable: false }) as any
const divEl = () => ({ tagName: 'DIV', isContentEditable: false }) as any

describe('shouldIgnore', () => {
  it('输入框内单字符忽略', () => {
    expect(shouldIgnore(inputEl(), parseBinding('j'))).toBe(true)
    expect(shouldIgnore(inputEl(), parseBinding('/'))).toBe(true)
  })
  it('输入框内 mod 组合不忽略', () => {
    expect(shouldIgnore(inputEl(), parseBinding('mod+k'))).toBe(false)
  })
  it('非输入框一律不忽略', () => {
    expect(shouldIgnore(divEl(), parseBinding('j'))).toBe(false)
    expect(shouldIgnore(divEl(), parseBinding('mod+k'))).toBe(false)
  })
  it('null target 不忽略', () => {
    expect(shouldIgnore(null, parseBinding('j'))).toBe(false)
  })
})
```

- [ ] **Step 3: 实现 `HotkeyHelpOverlay.tsx`**（dialog + 冲突高亮）

```tsx
// src/components/hotkeys/HotkeyHelpOverlay.tsx
'use client'
import { useEffect, useMemo, useRef } from 'react'
import { resolveBindings, detectConflicts, type Action } from '@/lib/hotkeys/registry'
import { formatBinding } from '@/lib/hotkeys/parse'

const LABELS: Record<Action, string> = {
  next: '下一封 (j)', prev: '上一封 (k)', reply: '回复 (r)', compose: '撰写 (c)',
  archive: '归档 (e)', delete: '删除 (#)', star: '标星 (s)', search: '搜索 (/)',
  help: '帮助 (?)', markRead: '标记已读 (m)', refresh: '刷新 (.)',
}

export function HotkeyHelpOverlay({ open, custom, onClose }: { open: boolean; custom: any; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const bindings = useMemo(() => resolveBindings(custom || {}), [custom])
  const conflicts = useMemo(() => detectConflicts(bindings), [bindings])
  const conflictKeys = new Set(conflicts.map((c) => `${c.mod}|${c.shift}|${c.alt}|${c.key}`))

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="快捷键帮助">
      <div ref={dialogRef} tabIndex={-1} className="rounded-lg bg-card p-6 shadow-xl outline-none">
        <h2 className="mb-3 text-lg font-bold">键盘快捷键</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {(Object.keys(bindings) as Action[]).map((a) => {
            const b = bindings[a]!
            const conflicted = conflictKeys.has(`${b.mod}|${b.shift}|${b.alt}|${b.key}`)
            return (
              <li key={a} className={`flex justify-between gap-4 ${conflicted ? 'text-red-500' : ''}`}>
                <span>{LABELS[a]?.split(' (')[0] || a}</span>
                <kbd className="rounded border px-1.5">{formatBinding(b)}{conflicted && ' ⚠冲突'}</kbd>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">按 Esc 关闭 · 设置中心可自定义</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 实现 `FocusTrap.tsx`**

```tsx
// src/components/hotkeys/FocusTrap.tsx
'use client'
import { useEffect, useRef, type ReactNode } from 'react'

export function FocusTrap({ children, active = true, onEscape, ariaLabel }: {
  children: ReactNode; active?: boolean; onEscape?: () => void; ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || !ref.current) return
    const node = ref.current
    const focusable = () => node.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
    const first = () => focusable()[0]
    first()?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onEscape?.(); return }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const f = items[0], l = items[items.length - 1]
      if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus() }
      else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [active, onEscape])

  return <div ref={ref} role="group" aria-label={ariaLabel}>{children}</div>
}
```

- [ ] **Step 5: 运行确认通过** `npx vitest run src/__tests__/hotkeys/` → PASS。`npx tsc --noEmit`。

- [ ] **Step 6: 接入 `mails/page.tsx`**：`useHotkeys(resolveBindings(custom), { next: ()=>moveSel(+1), prev: ()=>moveSel(-1), reply: ()=>..., compose: ()=>router.push('/compose'), archive: ()=>batchArchive(selectedId), delete: ()=>..., star: ()=>..., search: ()=>focusSearchInput(), help: ()=>setHelpOpen(true) })`；list/detail/compose 区各包 `<FocusTrap>`；加 `<HotkeyHelpOverlay open={helpOpen} ...>`。`moveSel` 调 `VirtualMessageList` 暴露的 `scrollToItem`。

- [ ] **Step 7: 手测**：j/k 上下移（含滚动到选中行）；r 跳 compose 带 reply 参数；c 撰写；e 归档（调 plan-08 批量端点）；# 删除；s 标星；/ 聚焦搜索框；? 唤起帮助浮层（Esc 关）；在搜索框内打字 j 不触发下一封；Tab 在各区循环不逃逸。

- [ ] **Step 8: Commit**

```bash
git add src/components/hotkeys/useHotkeys.ts src/components/hotkeys/HotkeyHelpOverlay.tsx src/components/hotkeys/FocusTrap.tsx src/__tests__/hotkeys/useHotkeys.test.ts src/app/mails/page.tsx
git commit -m "feat(hotkeys): useHotkeys hook + help overlay + focus trap (list/detail/compose)"
git push
```

---

### Task 6: 暗色主题切换（ThemeProvider + Toggle + CSS 变量）

**Files:**
- Create: `src/components/theme/ThemeProvider.tsx`
- Create: `src/components/theme/ThemeToggle.tsx`
- Create: `src/__tests__/theme/provider.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**关键设计：**
- **`ThemeProvider`**：context 持 `theme: 'light'|'dark'|'system'`；`resolvedTheme`（system 时据 `matchMedia('(prefers-color-scheme: dark)')` 解析）；副作用把 `<html data-theme="${resolved}">` + 写 `localStorage('theme')`。`prefers-color-scheme` 变化时（system 模式）重解析。
- **`ThemeToggle`**：按钮三态循环（light→dark→system）或下拉；图标（lucide `Sun`/`Moon`/`Monitor`）；`aria-label` + `aria-pressed`。
- **globals.css**：把现有散落的暗色意图（`bg-sidebar`、各类 `bg-card`/`text-foreground`）收敛为 CSS 变量 `--background`/`--foreground`/`--card`/`--sidebar` 等，`:root` 浅色 token、`[data-theme="dark"]` 暗色 token。Tailwind v4（项目用 `@tailwindcss/postcss`）通过 `@theme` / `var()` 引用。

- [ ] **Step 1: 写 `resolveTheme` 纯函数单测**（把 system→light/dark 的解析抽纯函数，脱离 matchMedia 测）

```ts
// src/__tests__/theme/provider.test.ts
import { describe, it, expect } from 'vitest'
// 把解析逻辑从组件抽到 src/lib/theme/resolve.ts 便于单测
import { resolveTheme } from '@/lib/theme/resolve'

describe('resolveTheme', () => {
  it('显式 light/dark 原样', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
  })
  it('system 跟随 prefers', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/theme/resolve.ts`**

```ts
// src/lib/theme/resolve.ts
export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}
```

- [ ] **Step 4: 实现 `ThemeProvider.tsx`** + **`ThemeToggle.tsx`**

```tsx
// src/components/theme/ThemeProvider.tsx
'use client'
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { resolveTheme, type ThemePref, type ResolvedTheme } from '@/lib/theme/resolve'

interface Ctx { pref: ThemePref; resolved: ResolvedTheme; setPref: (p: ThemePref) => void }
const ThemeCtx = createContext<Ctx>(null as any)
export const useTheme = () => useContext(ThemeCtx)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('system')
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as ThemePref) || 'system'
    setPrefState(saved)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setPrefersDark(mq.matches)
    const onChange = () => setPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(pref, prefersDark)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p); localStorage.setItem('theme', p)
  }, [])

  return <ThemeCtx.Provider value={{ pref, resolved, setPref }}>{children}</ThemeCtx.Provider>
}
```

```tsx
// src/components/theme/ThemeToggle.tsx
'use client'
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  const next = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light'
  const label = pref === 'light' ? '☀️ 浅色' : pref === 'dark' ? '🌙 暗色' : '🖥️ 跟随系统'
  return (
    <button onClick={() => setPref(next)} aria-label="切换主题" className="rounded border px-2 py-1 text-sm">
      {label}
    </button>
  )
}
```

- [ ] **Step 5: 改 `src/app/globals.css`**：`:root { --background: ...; --foreground: ...; --sidebar: ...; --card: ...; }` + `[data-theme="dark"] { --background: #0f1115; --foreground: #e6e6e6; --sidebar: #16181d; --card: #1a1d23; ... }`；现有 `bg-sidebar` 等改为 `background: var(--sidebar)`（或 Tailwind v4 `@theme inline` 映射）。

- [ ] **Step 6: 改 `src/app/layout.tsx`**：`<html>` 包 `<ThemeProvider>`；初始 `<html data-theme>` 由内联脚本（防闪）或默认 system 设置。

- [ ] **Step 7: 运行确认通过** `npx vitest run src/__tests__/theme/` → PASS。`npx tsc --noEmit`。

- [ ] **Step 8: 手测**：切换 light/dark/system 生效；刷新保持（localStorage）；系统暗色变化 system 跟随；无 FOUC（首屏不闪白）。

- [ ] **Step 9: Commit**

```bash
git add src/lib/theme/resolve.ts src/components/theme/ThemeProvider.tsx src/components/theme/ThemeToggle.tsx src/__tests__/theme/provider.test.ts src/app/layout.tsx src/app/globals.css
git commit -m "feat(theme): dark/light/system toggle (provider + toggle + CSS vars)"
git push
```

---

### Task 7: 响应式 / 移动端（断点 + 抽屉导航 + 触摸手势）

**Files:**
- Modify: `src/components/nav/AppShell.tsx`
- Create: `src/components/mail/MobileDrawer.tsx`
- Modify: `src/app/mails/page.tsx`

**关键设计：**
- **断点**（Tailwind 默认 md=768px）：
  - `md+`：三栏（sidebar + list + detail）现状不变。
  - `< md`：单栏 + 抽屉。Sidebar 收进抽屉（汉堡按钮唤起，`role="dialog" aria-modal`）；list 全宽；选中邮件 → detail 覆盖 list（返回按钮回 list）。
- **抽屉 `MobileDrawer`**：`open`/`onClose` props；`fixed` 左滑入；背景遮罩点击关闭；Esc 关闭；FocusTrap（复用 Task 5）。
- **触摸手势**（列表行）：左滑 → 露出「归档」按钮（调 plan-08 批量/单条归档）；右滑 → 露出「标星/删除」。用 pointer events + translateX + 阈值（滑过 40% 直接执行，否则回弹）。在 `VirtualMessageList` 行组件加手势层（或独立 `SwipeRow` wrapper）。
- **容器查询 vs 媒体查询**：用 Tailwind `md:` 前缀（CSS media）足够；AppShell 据此显隐。

- [ ] **Step 1: 实现 `MobileDrawer.tsx`**

```tsx
// src/components/mail/MobileDrawer.tsx
'use client'
import { useEffect, type ReactNode } from 'react'
import { FocusTrap } from '@/components/hotkeys/FocusTrap'

export function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="导航">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-0 top-0 h-full w-72 bg-sidebar shadow-xl">
        <FocusTrap active onEscape={onClose} ariaLabel="抽屉导航">
          {children}
        </FocusTrap>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 实现 `SwipeRow.tsx`**（左滑归档 / 右滑删除+标星）

```tsx
// src/components/mail/SwipeRow.tsx
'use client'
import { useRef, useState, type ReactNode } from 'react'

export function SwipeRow({ children, onArchive, onDelete, onStar }: {
  children: ReactNode; onArchive: () => void; onDelete: () => void; onStar: () => void
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<number | null>(null)
  const width = useRef(0)

  const onDown = (e: React.PointerEvent) => { start.current = e.clientX; width.current = (e.currentTarget.parentElement?.offsetWidth || 300) }
  const onMove = (e: React.PointerEvent) => {
    if (start.current == null) return
    const d = e.clientX - start.current
    if (Math.abs(d) > 8) setDx(Math.max(-width.current, Math.min(width.current, d)))
  }
  const onUp = () => {
    const d = dx; start.current = null; setDx(0)
    if (d < -width.current * 0.4) onArchive()
    else if (d > width.current * 0.4) onDelete()
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-between px-4 text-xs text-white">
        <span className="bg-red-500 px-2 py-1 rounded">删除</span>
        <span className="bg-blue-500 px-2 py-1 rounded">归档</span>
      </div>
      <div
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDx(0) }}
        className="relative touch-pan-y bg-card"
      >
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 改 `AppShell.tsx`**：`md:` 下显示常驻 sidebar；`< md` 隐藏 sidebar + 顶部汉堡按钮 → 控制 `MobileDrawer open`。list 全宽（`w-full md:w-[340px]`）。detail 在 `< md` 选中后全屏覆盖 list（`selectedMessage ? 'block' : 'hidden'` 的 `md:block` 控制）。

- [ ] **Step 4: 手测**（DevTools 移动端视口）：单栏布局；汉堡唤起抽屉；选中邮件 detail 覆盖；列表行左滑归档/右滑删除；Esc 关抽屉。

- [ ] **Step 5: `npx tsc --noEmit` → 无错误。Commit**

```bash
git add src/components/mail/MobileDrawer.tsx src/components/mail/SwipeRow.tsx src/components/nav/AppShell.tsx src/app/mails/page.tsx
git commit -m "feat(responsive): mobile breakpoints + drawer nav + swipe gestures (archive/delete)"
git push
```

---

### Task 8: PWA + Service Worker（manifest + sw.js + 离线缓存 + 断网待同步）

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Modify: `next.config.ts`
- Create: `src/components/pwa/registerSW.ts`（客户端注册 + 更新提示）
- Modify: `src/app/layout.tsx`（注册 SW）

**关键设计（遵循 `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`）：**
- **`app/manifest.ts`**（Next 16 文件约定，自动生成 `/manifest.webmanifest`）：`name/short_name/start_url:'/'/display:'standalone'/theme_color/background_color/icons[192/512]`。icons 放 `public/`（现有 svg 需补 192/512 png，实现时生成或用占位 svg + `purpose:any`）。
- **`public/sw.js`**（原生 Service Worker，不用 next-pwa/serwist 以保零额外构建依赖）：
  - `install`：预缓存 app shell（`/`、`/mails`、`/manifest.webmanifest`、关键静态资源）。
  - `activate`：清旧缓存。
  - `fetch`：**stale-while-revalidate** for 同源 GET（导航请求 network-first 离线回壳页；API `/api/messages`、`/api/messages/[id]` network-first 失败回缓存最近邮件）；写请求（POST/PATCH/DELETE）不缓存。
  - `sync`（Background Sync）：`event.tag==='outbox-sync'` → 重放 IndexedDB 里暂存的断网发送操作（与 plan-13 outbox 衔接：断网时 `fetch('/api/outbox')` 失败 → 存 IndexedDB `pendingOutbox` → 注册 `registration.sync.register('outbox-sync')` → SW sync 触发重放）。本地单机断网少发，但 PWA 离线场景（已安装应用离线打开）需要。
- **`next.config.ts` headers**：`/sw.js` → `Content-Type: application/javascript; charset=utf-8` + `Cache-Control: no-cache, no-store, must-revalidate` + `Service-Worker-Allowed: /`；全局加 `X-Content-Type-Options: nosniff`（与 plan-11 安全收敛呼应）。
- **`registerSW.ts`**：客户端 `navigator.serviceWorker.register('/sw.js')`；监听 `controllerchange` 显示「有新版本刷新」提示。

- [ ] **Step 1: 实现 `src/app/manifest.ts`**

```ts
// src/app/manifest.ts
import type { MetadataRoute } from 'next'
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ActBox 邮件待办',
    short_name: 'ActBox',
    description: '本地单机 web 邮箱 + 待办',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
```

- [ ] **Step 2: 实现 `public/sw.js`**（壳页缓存 + SWR + outbox-sync 重放）

```js
// public/sw.js
const SHELL = ['/', '/mails', '/manifest.webmanifest']
const C_SHELL = 'actbox-shell-v1'
const C_API = 'actbox-api-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C_SHELL).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![C_SHELL, C_API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET') return // 写请求交给 sync
  // 导航:network-first 离线回壳页
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')))
    return
  }
  // API:network-first 失败回缓存(最近邮件)
  if (url.pathname.startsWith('/api/messages')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(C_API).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() => caches.match(req).then((r) => r || new Response('[]', { headers: { 'content-type': 'application/json' } })))
    )
    return
  }
  // 同源静态:stale-while-revalidate
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(C_SHELL).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
      )
    )
  }
})
// 断网 outbox 重放(与 plan-13 衔接):前端断网时把待发请求存 IndexedDB 并注册 sync
self.addEventListener('sync', (e) => {
  if (e.tag === 'outbox-sync') {
    e.waitUntil(replayPendingOutbox())
  }
})
async function replayPendingOutbox() {
  const db = await openIDB()
  const all = await db.getAll('pendingOutbox')
  for (const item of all) {
    try {
      const res = await fetch(item.url, item.init)
      if (res.ok) await db.delete('pendingOutbox', item.id)
    } catch { /* 仍未联网,下次 sync 再试 */ }
  }
}
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('actbox-sw', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('pendingOutbox', { keyPath: 'id', autoIncrement: true }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
```

- [ ] **Step 3: 改 `next.config.ts`** 加 headers

```ts
// next.config.ts
import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}
export default nextConfig
```

- [ ] **Step 4: 实现 `registerSW.ts`** + 接入 `layout.tsx`

```ts
// src/components/pwa/registerSW.ts
'use client'
import { useEffect } from 'react'
export function registerSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    const onCtrl = () => { /* 可选:提示新版本 */ }
    navigator.serviceWorker.addEventListener('controllerchange', onCtrl)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onCtrl)
  }, [])
}
```

`layout.tsx` 在客户端组件里调 `registerSW()`（或放 AppShell 的 useEffect）。

- [ ] **Step 5: 生成图标** `public/icon-192.png` / `icon-512.png`（用现有 svg 或 favicon 工具生成；若暂时只放 svg，manifest icons 至少含一个 png 满足安装条件——Chrome 要求 192 + 512 png）。**实现时必须补真实 png**，否则安装按钮不出。

- [ ] **Step 6: `npx tsc --noEmit` → 无错误。手测**：`next build && next start`（SW 只在生产模式生效，dev 下 SW 行为不稳定）→ DevTools Application → Service Worker 已注册 + Manifest 可识别 + Lighthouse PWA 审计可安装；断网后壳页可打开、最近邮件从缓存可读；安装到桌面/任务栏。

- [ ] **Step 7: Commit**

```bash
git add src/app/manifest.ts public/sw.js public/icon-192.png public/icon-512.png next.config.ts src/components/pwa/registerSW.ts src/app/layout.tsx
git commit -m "feat(pwa): web manifest + service worker (offline cache shell/messages + outbox background sync)"
git push
```

---

### Task 9: 无障碍（字体缩放 + aria 标注 + aria-live 新邮件）

**Files:**
- Create: `src/lib/a11y/font-scale.ts`
- Create: `src/__tests__/a11y/font-scale.test.ts`
- Create: `src/components/a11y/NewMailLiveRegion.tsx`
- Modify: `src/app/mails/page.tsx`、`src/components/EmailBody.tsx`、`src/components/mail/VirtualMessageList.tsx`

**关键设计：**
- **字体缩放**：`setFontScale(level: 'sm'|'md'|'lg')` → 写 `<html style="--font-scale: 1.0|1.15|1.3">` + `localStorage('fontScale')`；CSS 里 `html { font-size: calc(16px * var(--font-scale, 1)) }`，所有尺寸用 rem → 整体随缩放。设置项或 toolbar 暴露切换。
- **aria 标注**：
  - `VirtualMessageList` 容器 `role="list" aria-label="邮件列表"`，行 `role="listitem" aria-current={selected}`，已读/未读用 `aria-label="未读: 主题"`。
  - 按钮全部 `aria-label`（星标/删除/归档/主题切换）。
  - `EmailBody` iframe 容器 `role="region" aria-label="邮件正文"`。
  - dialog（帮助浮层/抽屉/compose）`role="dialog" aria-modal`。
  - 所有交互元素 `:focus-visible` 可见焦点环（globals.css 已有，确认覆盖）。
- **`NewMailLiveRegion`**：`role="status" aria-live="polite"`，收到 plan-06 SSE 新邮件事件时更新文本「新邮件:N 封」供屏幕阅读器播报。不在视觉区显示（`sr-only`）或小角标。

- [ ] **Step 1: 写 font-scale 单测**

```ts
// src/__tests__/a11y/font-scale.test.ts
import { describe, it, expect } from 'vitest'
import { fontScaleValue, type FontScale } from '@/lib/a11y/font-scale'

describe('fontScaleValue', () => {
  it('sm/md/lg 三档', () => {
    expect(fontScaleValue('sm')).toBeCloseTo(1.0)
    expect(fontScaleValue('md')).toBeCloseTo(1.15)
    expect(fontScaleValue('lg')).toBeCloseTo(1.3)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `src/lib/a11y/font-scale.ts`**

```ts
// src/lib/a11y/font-scale.ts
export type FontScale = 'sm' | 'md' | 'lg'
export function fontScaleValue(level: FontScale): number {
  return level === 'sm' ? 1.0 : level === 'lg' ? 1.3 : 1.15
}
export function applyFontScale(level: FontScale) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--font-scale', String(fontScaleValue(level)))
  localStorage.setItem('fontScale', level)
}
```

`globals.css` 加 `html { font-size: calc(16px * var(--font-scale, 1)); }`。

- [ ] **Step 4: 实现 `NewMailLiveRegion.tsx`**

```tsx
// src/components/a11y/NewMailLiveRegion.tsx
'use client'
import { useEffect, useState } from 'react'
export function NewMailLiveRegion() {
  const [text, setText] = useState('')
  useEffect(() => {
    // 接 plan-06 SSE 事件 bus:收到新邮件计数时 setText(`新邮件到达`)
    const handler = (e: Event) => setText(`新邮件:${(e as CustomEvent).detail?.count || 1} 封`)
    window.addEventListener('actbox:new-mail', handler)
    return () => window.removeEventListener('actbox:new-mail', handler)
  }, [])
  return <div role="status" aria-live="polite" className="sr-only">{text}</div>
}
```

- [ ] **Step 5: 补 aria 标注**：改 `VirtualMessageList` 行（Step 3 已含 role/aria-current，补 `aria-label` 区分未读）、`EmailBody.tsx`（容器加 role/aria-label）、`mails/page.tsx` 各按钮补 `aria-label`、加 `<NewMailLiveRegion />`、加字体缩放切换入口（toolbar）。

- [ ] **Step 6: 运行确认通过** `npx vitest run src/__tests__/a11y/` → PASS。`npx tsc --noEmit`。

- [ ] **Step 7: 手测（可及性）**：键盘 Tab 遍历所有交互（焦点环可见）；VoiceOver/读屏读列表/按钮/新邮件播报；字体 lg 档整体放大；`role/aria` 在 DevTools Accessibility 面板正确。

- [ ] **Step 8: Commit**

```bash
git add src/lib/a11y/font-scale.ts src/__tests__/a11y/font-scale.test.ts src/components/a11y/NewMailLiveRegion.tsx src/components/EmailBody.tsx src/components/mail/VirtualMessageList.tsx src/app/mails/page.tsx src/app/globals.css
git commit -m "feat(a11y): font scaling + aria labeling + aria-live new-mail region"
git push
```

---

## 验收标准

- [ ] **游标分页**：`GET /api/messages` 不再 `.all()` 全量；`?cursor=&limit=` 复合游标 `(received_at, id)` 分页，默认 limit=50（clamp [10,200]），返回 `{ messages, nextCursor, unreadCount }`；翻页不重叠、末页 `nextCursor=null`；cursor 与筛选（unread/starred/search）叠加正确；非法 cursor → 400；10 万封首屏 <1.5s、不 OOM（测试覆盖分页逻辑；性能靠分页 + 虚拟滚动保证）。
- [ ] **worker_threads 隔离**：`runInWorker()` 把只读 SELECT 下沉到 worker 线程（事件循环非阻塞），只读白名单（拒绝写语句 → `ok:false`），超时 reject，worker 崩溃自愈重建。
- [ ] **虚拟滚动**：邮件列表用 react-window `FixedSizeList`，滚到底预取下一页（`onItemsRendered` 触发 `loadMore(cursor)`）；单文件夹 10 万+ 行滚动 60fps 不卡；空/加载态正常。
- [ ] **快捷键**：`useHotkeys` 绑定 j/k/r/c/e/#/s//?/. 等；可自定义（settings `hotkeys.bindings`）+ 冲突检测（`detectConflicts` 帮助浮层高亮）+ 帮助浮层 `?` 唤起（Esc 关）+ 焦点管理（list↔detail↔compose FocusTrap，Tab 不逃逸，输入框内单字符不误触）。
- [ ] **响应式/移动端**：`md+` 三栏、`< md` 单栏 + 抽屉导航（汉堡/Esc/遮罩关闭）+ 列表行触摸手势（左滑归档、右滑删除）。
- [ ] **PWA**：`app/manifest.ts` 可识别 + 真实 png 图标（192/512）；`public/sw.js` 注册成功（生产模式）；壳页/最近邮件离线可读；outbox 断网 Background Sync 重放；`next.config.ts` sw.js headers（CSP/Cache-Control/Service-Worker-Allowed）；可安装到桌面/任务栏（Lighthouse PWA 可安装）。
- [ ] **暗色主题**：ThemeProvider（light/dark/system）+ Toggle + CSS 变量；刷新保持（localStorage）；system 跟随 `prefers-color-scheme`；无 FOUC。
- [ ] **无障碍**：字体缩放（sm/md/lg，rem 基准）；所有交互元素 aria-label + `:focus-visible`；list/dialog/region role 标注；`aria-live` 新邮件播报。
- [ ] `npm test` 全绿（messages/{cursor,pages}、api/messages-pagination、db/worker、hotkeys/{parse,registry,useHotkeys}、theme/provider、a11y/font-scale）。
- [ ] `npx tsc --noEmit` 无类型错误。
- [ ] （P2 预留）react-window 动态行高（消息预览多行）——本计划 FixedSize 够用；PWA Push Notification（VAPID/web-push）——本计划仅离线缓存 + Background Sync，推送待 plan-06 通知体系扩展。

## 依赖

- **子项目 3（文件夹/列表数据视图）**：`messages` 有 `account_id/folder/received_at`、列表筛选参数（direction/folder/unread/starred）稳定——游标分页与虚拟列表的消费方。本计划 Task 1 的分页查询基于 `received_at` 列存在（现有 schema 已有 `receivedAt`）。
- **子项目 8（批量操作）**：快捷键 e（归档）/ #（删除）复用其批量端点（单条归档/删除）；标签批量贴标若快捷键扩展也依赖。
- **现有**：`src/app/api/messages/route.ts`（待改造，去 `.all()`）、`src/lib/db/index.ts`（`getDb()` + better-sqlite3）、`src/lib/db/schema.ts`（`messages.receivedAt` timestamp mode）、`src/components/nav/AppShell.tsx`（三栏布局）、`src/app/mails/page.tsx`（列表消费方）、`src/app/globals.css`（CSS 变量化）、`src/app/layout.tsx`（Provider/SW/manifest 挂载点）。
- **plan-06（SSE/通知）**：Task 9 的 `NewMailLiveRegion` 监听 `actbox:new-mail` 事件（plan-06 SSE 发布）；plan-13（outbox）：Task 8 SW 的 `outbox-sync` 重放与之衔接。
- **新依赖**：`react-window`（+ `@types/react-window`）；可选 `react-virtualized-auto-sizer`（若 FixedSize 高度兜底不便）。

## 风险

- **received_at 列秒级 + 同秒多封**：游标仅用 `received_at` 会漏/重（同秒边界行）。**缓解**：复合游标 `(received_at, id)`，`id` 作 tie-break，`WHERE received_at < rt OR (received_at = rt AND id < id)` 严格降序不重不漏；测试覆盖同秒多封。
- **drizzle timestamp mode 序列化差异**：游标分页后裸 `db.prepare` 返回 `received_at` 为 epoch 秒，而旧前端按 ISO 字符串 `new Date(str)`。**缓解**：Task 3 虚拟列表行组件统一 `new Date(sec * 1000)`；现有依赖 ISO 的地方同步改；以 `messages-pagination.test.ts` 数值断言为准。
- **worker_threads 在 dev/测试环境的 TS 加载**：`new Worker(worker-script.ts)` 需 Node 能加载 TS（`--experimental-strip-types` / tsx）否则要编译产物路径。**缓解**：优先 `new Worker(new URL('./worker-script.ts', import.meta.url))`；回退编译 `.js`；`worker.test.ts` 全绿为最终判据；生产 `next build` 产物走编译后路径。
- **worker 读同一 db 文件的并发**：主线程写 + worker 读，WAL 多读单写安全；但 worker `readonly:true` 打开若 db 正被独占（VACUUM）会报错。**缓解**：worker 只跑 SELECT；VACUUM/备份（plan §2.5）是短时独占，worker 查询失败 `ok:false` 由调用方重试或降级主线程同步查询。
- **react-window 行高固定但预览可变**：FixedSizeList 假定等高行，多行预览会被截断。**缓解**：行预览单行 `truncate`（现状即单行）；P2 若需动态高度换 `VariableSizeList`。
- **PWA dev 模式 SW 不稳定**：SW 注册/缓存行为在 `next dev` 下不可靠（HMR 冲突）。**缓解**：PWA 手测一律 `next build && next start`；dev 下用 `navigator.serviceWorker` 仍注册但缓存策略以生产为准；Lighthouse 审计跑生产构建。
- **Service Worker 缓存陈旧/版本升级**：SW 更新后旧缓存残留、壳页用旧版。**缓解**：缓存名带版本（`actbox-shell-v1`）、`activate` 清旧、`skipWaiting + clients.claim` 加速接管；`registerSW` 监听 `controllerchange` 提示刷新。
- **暗色 FOUC（首屏闪白）**：客户端 JS 读 localStorage 设 `data-theme` 前 `<html>` 是默认（可能浅色），暗色用户首屏闪一下白。**缓解**：`layout.tsx` 内联一段阻塞脚本在 `<head>` 第一时间读 localStorage + prefers 设 `data-theme`（React hydration 前执行）。
- **快捷键与浏览器/IME 冲突**：`#`/`/`/`?` 在某些浏览器或中文 IMAP 下行为不一；j/k 在输入法开启时 key 可能不同。**缓解**：输入框聚焦时禁用单字符（`shouldIgnore`）；非输入框场景 IMAP 通常不影响；冲突的浏览器默认键（如 `/` Firefox 快速查找）preventDefault 覆盖；帮助浮层列出所有绑定便于用户发现与自定义规避。
- **移动端触摸手势误触**：列表行滑动可能与垂直滚动冲突（horizontal pan vs vertical scroll）。**缓解**：`touch-pan-y`（允许垂直滚动）+ 仅水平位移 > 阈值才判定为滑动手势、位移小则交还滚动；手测覆盖。
