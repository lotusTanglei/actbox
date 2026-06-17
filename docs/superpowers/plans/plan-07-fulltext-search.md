# 子项目 7 — 全文搜索(FTS5)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把跨文件夹/账号的邮件检索从 `LIKE` 升级为 SQLite FTS5 全文索引（subject/from/to/全文 body/body_html_text），`MATCH` + `bm25()` 相关性排序，`<500ms`；落地 Gmail 子集操作符解析器、搜索结果页（排序+二次过滤）、Saved Search 常驻侧栏、搜索历史 + 输入联想。

**Architecture:** 方案 B（spec §0/§1/子项目 7）。本地单机、与主库 better-sqlite3 同进程同事务。`messages_fts` 用 FTS5 **外部内容表**（`content='messages', content_rowid='id'`）+ 三组触发器（INSERT/UPDATE/DELETE）把 messages 的写入同步进 FTS，零双写强一致。中文用 **jieba 预分词**：不依赖编译型自定义 tokenizer（跨平台构建风险高），而是写入侧把 `subject/from/to/body/body_html_text` 先过 jieba 切词、用空格连接后塞进 FTS5 的 `tokenize='unicode61'`（CJK 落到 unicode61 默认不切词的问题由"写入前已切好词"解决）；查询侧同样 jieba 切词后再 MATCH。`/api/messages` GET 的 `search` 参数改走 FTS5（跨 folder/account），操作符（`from:`/`to:`/`subject:`/`has:attachment`/`after:`/`before:`/`is:unread`/`is:starred`）解析成 FTS MATCH 子句 + 结构化 SQL 条件的组合。Saved Search 存 settings KV，搜索历史存独立 KV。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / SQLite FTS5 / @node-rs/jieba（纯 Rust napi，预编译二进制免编译）/ vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`（用户要求每任务提交推送）。本子项目依赖子项目 1（messages `body` 存全文不截断 + drizzle 迁移框架 + `sender/to/body_html/account_id/folder/is_read/is_starred` 列）与子项目 3（messages `folder/account_id` 跨文件夹检索 + `folders` 表）。执行前补全每个任务的 TDD 微步骤（先红后绿）。

---

## 文件结构

- Create: `drizzle/XXXX_fts5_messages.sql`（手写 FTS5 虚表 + 触发器迁移；不依赖 drizzle-kit 对虚表的弱支持）
- Create: `src/lib/db/fts-migrate.ts` — 幂等执行 FTS5 虚表/触发器 DDL + 存量回填
- Create: `src/lib/db/body-html-text.ts` — `body_html` → 纯文本（去标签）→ `body_html_text` 写入（FTS 用）
- Create: `src/lib/search/segmenter.ts` — jieba 分词封装（`segment(text): string` 切词后空格连接），单例懒加载
- Create: `src/lib/search/query-parser.ts` — 操作符解析器（Gmail 子集）→ `ParsedQuery`
- Create: `src/lib/search/fts.ts` — `buildFtsSql(parsed, opts)` 生成 FTS5 MATCH + 结构化条件 SQL + `bm25()` 排序；`searchMessages(db, parsed, opts)`
- Modify: `src/lib/db/schema.ts` — messages 增 `bodyHtmlText` 列（`body_html_text`）+ 不在 drizzle 建虚表（虚表手写）
- Modify: `src/lib/db/index.ts` — `getDb()` migrate 后执行 FTS5 迁移（`runFtsMigrate(db)`）
- Modify: `src/app/api/fetch/route.ts` / `src/app/api/send/route.ts` / `src/lib/scheduler/index.ts` / 收件入库路径 — 入库时写 `body_html_text`（触发器自动同步 FTS，无需手写 FTS insert）
- Modify: `src/app/api/messages/route.ts` — GET 的 `search`/`q` 参数改走 `searchMessages`，支持操作符 + 排序 + 二次过滤
- Create: `src/app/api/search/saved/route.ts` — GET 列出 / POST 新建 Saved Search
- Create: `src/app/api/search/saved/[id]/route.ts` — DELETE 删除 Saved Search
- Create: `src/app/api/search/history/route.ts` — GET 搜索历史 + POST 记录 / DELETE 清空
- Create: `src/app/search/page.tsx` — 搜索结果页（按 时间/相关性/发件人 排序 + 二次过滤 + 高亮 + 分页/游标）
- Create: `src/components/search/SearchBar.tsx` — 顶部搜索框（操作符输入联想 + 历史）
- Create: `src/components/search/SavedSearches.tsx` — 侧栏常驻 Saved Search 列表
- Create: `src/components/search/SearchSuggest.tsx` — 输入联想（历史 + 操作符补全）
- Test: `src/__tests__/search/fts-migrate.test.ts`、`src/__tests__/search/segmenter.test.ts`、`src/__tests__/search/query-parser.test.ts`、`src/__tests__/search/fts.test.ts`、`src/__tests__/api/search-messages.test.ts`、`src/__tests__/api/search-saved.test.ts`、`src/__tests__/api/search-history.test.ts`

---

## 任务

### Task 1: 依赖 + jieba 分词封装

**Files:**
- Modify: `package.json`（依赖）
- Create: `src/lib/search/segmenter.ts`
- Test: `src/__tests__/search/segmenter.test.ts`

**关键设计：** 选 `@node-rs/jieba`（Rust napi，npm 上有 darwin/linux/x64/arm64 预编译二进制，免 node-gyp 编译，规避跨平台构建风险）。不选 `nodejieba`（需 node-gyp 编译，macOS/Linux/Windows 工具链差异大）。中文写入前 jieba 切词后空格连接，英文/数字 unicode61 原生处理；查询同样切词。单例懒加载（首调 `init()` 加载词典，后续复用）。

- [ ] **Step 1: 安装依赖**

Run: `npm i @node-rs/jieba`
Expected: 安装成功，`node_modules/@node-rs/jieba` 存在且含平台预编译 `.node`。

- [ ] **Step 2: 写失败测试 `src/__tests__/search/segmenter.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { segment, tokenizeQuery } from '@/lib/search/segmenter'

describe('jieba 分词', () => {
  it('中文切词后空格连接，保留英文/数字', () => {
    expect(segment('发票报销流程invoice2024')).toMatch(/\S*发\s*票\S* \S*报\s*销\S*/)
    // 更宽松的断言：切词结果包含"发票"和"报销"两段（顺序无关，但都在）
    const s = segment('发票报销流程')
    expect(s).toContain('发票')
    expect(s).toContain('报销')
  })
  it('英文短语保持词形、按空格分', () => {
    expect(segment('quarterly report')).toContain('quarterly')
    expect(segment('quarterly report')).toContain('report')
  })
  it('空串/纯空白返回空串', () => {
    expect(segment('')).toBe('')
    expect(segment('   ')).toBe('')
  })
  it('tokenizeQuery 去多余空白 + 小写', () => {
    expect(tokenizeQuery('  Foo  BAR ')).toBe('foo bar')
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run src/__tests__/search/segmenter.test.ts`
Expected: FAIL（`@/lib/search/segmenter` 不存在）。

- [ ] **Step 4: 实现 `src/lib/search/segmenter.ts`**

```ts
import { cut as jiebaCut } from '@node-rs/jieba'

let inited = false
function ensureInited() {
  if (inited) return
  // @node-rs/jieba 首次调用内部加载默认词典；显式 init 可预热
  jiebaCut('预热', false)
  inited = true
}

/** 把文本切词后用空格连接，供 FTS5 写入与查询复用。 */
export function segment(text: string): string {
  if (!text || !text.trim()) return ''
  ensureInited()
  const toks = jiebaCut(text, false) // false = 精确模式（搜索场景够用）
  return toks.filter(Boolean).join(' ')
}

/** 查询专用：切词 + 去重空白 + 小写（FTS MATCH 大小写不敏感，统一便于拼接操作符）。 */
export function tokenizeQuery(text: string): string {
  return segment(text).replace(/\s+/g, ' ').trim().toLowerCase()
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/__tests__/search/segmenter.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/search/segmenter.ts src/__tests__/search/segmenter.test.ts
git commit -m "feat(search): jieba segmentation via @node-rs/jieba (prebuilt, no compile)"
git push
```

---

### Task 2: messages 增 body_html_text 列 + body_html 纯文本提取

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/db/body-html-text.ts`
- Test: `src/__tests__/search/body-html-text.test.ts`

**关键设计：** FTS5 外部内容表索引 `body_html` 时会带着 HTML 标签噪声（`<div>`、`&nbsp;` 命中"div"无意义），故 messages 增 `body_html_text` 列存"去标签纯文本"，FTS 索引它而非 `body_html` 本身。`body` 列（plan-01 已修为全文纯文本）单独索引，二者互补：`body` 是发件/解析路径产出的纯文本，`body_html_text` 是 HTML 邮件去标签文本（HTML 邮件正文 body 可能只是摘要而 html 才全）。

- [ ] **Step 1: schema.ts 加列**

```ts
// messages 表内增：
bodyHtmlText: text('body_html_text'), // 新：body_html 去标签纯文本，供 FTS 索引
```
Run: `npm run db:generate`（产出 `ALTER TABLE messages ADD COLUMN body_html_text`）。

- [ ] **Step 2: 写失败测试 `src/__tests__/search/body-html-text.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { htmlToText } from '@/lib/db/body-html-text'

describe('htmlToText', () => {
  it('去标签 + 解码实体 + 折叠空白', () => {
    expect(htmlToText('<p>Hello&nbsp;World</p>')).toBe('Hello World')
  })
  it('去 script/style 内容', () => {
    expect(htmlToText('<style>a{}</style><script>x()</script>hi')).toBe('hi')
  })
  it('空/非字符串 → 空串', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText(null as any)).toBe('')
  })
})
```

- [ ] **Step 3: 运行确认失败**：`npx vitest run src/__tests__/search/body-html-text.test.ts` → FAIL。

- [ ] **Step 4: 实现 `src/lib/db/body-html-text.ts`**

用 `DOMPurify` + `jsdom` 的 `JSDOM`（DOMPurify 已在子项目 11/§2.4 引入；若未装则 `npm i dompurify jsdom`）或轻量正则。生产用 DOMPurify（与渲染侧净化一致、防 XSS 双重收益），实现：
```ts
import { JSDOM } from 'jsdom'
import DOMPurify from 'dompurify'

const window = new JSDOM('').window
const purify = DOMPurify(window as any)

export function htmlToText(html: string): string {
  if (!html || typeof html !== 'string') return ''
  const clean = purify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as string
  return clean.replace(/\s+/g, ' ').trim()
}
```
（`ALLOWED_TAGS:[]` 等价于纯文本提取，先净化再折叠空白。）

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: 入库路径写 body_html_text**

Modify `src/app/api/fetch/route.ts`、`src/app/api/send/route.ts`、`src/lib/scheduler/index.ts`：入库 messages 时，若 `bodyHtml` 非空则 `bodyHtmlText: htmlToText(mail.bodyHtml)`；若无 HTML 则 `bodyHtmlText: null`（FTS 触发器对 NULL 写空索引）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ src/lib/db/body-html-text.ts src/__tests__/search/body-html-text.test.ts src/app/api/fetch/route.ts src/app/api/send/route.ts src/lib/scheduler/index.ts
git commit -m "feat(db): body_html_text column (sanitized HTML→text) for FTS indexing"
git push
```

---

### Task 3: FTS5 虚表 + 触发器迁移（外部内容表）

**Files:**
- Create: `drizzle/XXXX_fts5_messages.sql`（手写 DDL，命名与 drizzle journal 对齐，如 `0020_fts5_messages.sql`）
- Create: `src/lib/db/fts-migrate.ts`
- Modify: `src/lib/db/index.ts`
- Test: `src/__tests__/search/fts-migrate.test.ts`

**关键设计：** drizzle-kit 不支持生成 FTS5 虚表与触发器，故手写 SQL 走幂等执行器（`CREATE VIRTUAL TABLE IF NOT EXISTS` + `CREATE TRIGGER IF NOT EXISTS`），不进 drizzle journal（虚表无需 schema 演进追踪，幂等 DDL 足够）。外部内容表 `content='messages', content_rowid='id'`：FTS 不存正文副本、靠 rowid 回查 messages，省空间且天然与主表一致。**触发器列名与 messages 真实列严格一致**：`sender`(from)、`to`、`subject`、`body`、`body_html_text`。写入 FTS 时对每列 `segment(NEW.列)` 预分词（在触发器里调 SQLite 自定义函数 `segment()`，见 Task 4 注册）——为避免触发器内调 JS 函数的性能与事务复杂性，**触发器写入原始文本，由应用层在 INSERT/UPDATE messages 前先把要写的列预分词**不可行（会污染主表）。故采用：**触发器内调用 SQLite 自定义标量函数 `segment()`（Task 4 用 `db.function()` 注册 better-sqlite3 JS 函数）**，FTS 收到的是已切词文本。

- [ ] **Step 1: 写失败测试 `src/__tests__/search/fts-migrate.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runFtsMigrate, registerSegmentFunction } from '@/lib/db/fts-migrate'

const tmp = () => `./data/test-fts-${process.pid}-${Date.now()}.db`

describe('FTS5 迁移', () => {
  let path: string, db: Database.Database
  beforeEach(() => {
    path = tmp()
    db = new Database(path)
    // 建一个最小 messages（含真实列名）
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY, message_id TEXT UNIQUE, subject TEXT, sender TEXT,
      "to" TEXT, body TEXT, body_html_text TEXT, account_id INTEGER, folder TEXT,
      is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0
    )`)
  })
  afterEach(() => { db.close(); try { require('fs').unlinkSync(path) } catch {} })

  it('建出 messages_fts 虚表 + 三组触发器（幂等二次执行不报错）', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'").get()).toBeTruthy()
    const trigs = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='messages'").all() as { name: string }[]
    expect(trigs.map(t => t.name).sort()).toEqual([
      'messages_fts_ai', 'messages_fts_ad', 'messages_fts_au',
    ].sort())
    runFtsMigrate(db) // 幂等
  })

  it('INSERT messages → 触发器自动写 FTS；MATCH 命中', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder)
             VALUES ('<m1>', '发票报销', 'boss@x.com', 'me@x.com', '请尽快处理发票', '正文报销单', 1, 'INBOX')`)
    const hit = db.prepare(`SELECT m.message_id FROM messages_fts f JOIN messages m ON m.id = f.rowid
                            WHERE messages_fts MATCH ? ORDER BY bm25(messages_fts) LIMIT 10`)
      .all('发票') as { message_id: string }[]
    expect(hit.map(h => h.message_id)).toContain('<m1>')
  })

  it('UPDATE messages.subject → FTS 同步新值', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder) VALUES ('<m2>', '旧主题', 'a@x', 'b@x', '', '', 1, 'INBOX')`)
    db.exec(`UPDATE messages SET subject='全新主题' WHERE message_id='<m2>'`)
    const old = db.prepare("SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '旧主题'").get()
    expect(old).toBeUndefined()
    const neu = db.prepare("SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '全新主题'").get()
    expect(neu).toBeTruthy()
  })

  it('DELETE messages → FTS 行清除', () => {
    registerSegmentFunction(db)
    runFtsMigrate(db)
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder) VALUES ('<m3>', '删除测试', 'a@x', 'b@x', '', '', 1, 'INBOX')`)
    db.exec(`DELETE FROM messages WHERE message_id='<m3>'`)
    const hit = db.prepare("SELECT 1 FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH '删除测试'").get()
    expect(hit).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/search/fts-migrate.test.ts` → FAIL。

- [ ] **Step 3: 写 DDL `drizzle/0020_fts5_messages.sql`**

```sql
-- FTS5 外部内容表：索引 messages 的 subject/from(to 列 sender)/to/全文 body/body_html_text
-- content_rowid 映射 messages.id；FTS 不存正文副本，靠 rowid 回查。
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject,
  sender,
  "to",
  body,
  body_html_text,
  content='messages',
  content_rowid='id',
  tokenize='unicode61'
);

-- INSERT：新行进 FTS（对每列调 segment() 预分词）
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, sender, "to", body, body_html_text)
  VALUES (NEW.id, segment(NEW.subject), segment(NEW.sender), segment(NEW."to"), segment(NEW.body), segment(NEW.body_html_text));
END;

-- DELETE：旧行从 FTS 移除
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, sender, "to", body, body_html_text)
  VALUES ('delete', OLD.id, OLD.subject, OLD.sender, OLD."to", OLD.body, OLD.body_html_text);
END;

-- UPDATE：先删旧再插新（FT5 外部内容表标准模式）
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, sender, "to", body, body_html_text)
  VALUES ('delete', OLD.id, OLD.subject, OLD.sender, OLD."to", OLD.body, OLD.body_html_text);
  INSERT INTO messages_fts(rowid, subject, sender, "to", body, body_html_text)
  VALUES (NEW.id, segment(NEW.subject), segment(NEW.sender), segment(NEW."to"), segment(NEW.body), segment(NEW.body_html_text));
END;
```
> 注：FTS5 "delete" 命令对外部内容表要求提供全部原始列值（用于删除验证），故 AD/AU 的 VALUES 用 OLD 原始列值（未分词），AI/AU 的插新用 `segment()` 分词值。触发器列名（`subject/sender/to/body/body_html_text`）与 messages 真实列严格一致。

- [ ] **Step 4: 实现 `src/lib/db/fts-migrate.ts`**

```ts
import type Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { segment } from '@/lib/search/segmenter'

/** 注册 SQLite 自定义标量函数 segment()，供触发器调用做中文预分词。幂等。 */
export function registerSegmentFunction(db: Database.Database) {
  // better-sqlite3: 重复注册同名函数会抛错，try/catch 兜底幂等
  try {
    db.function('segment', { deterministic: true, directOnly: true }, (s: unknown) => {
      if (s == null) return null
      return segment(String(s))
    })
  } catch { /* 已注册 */ }
}

/** 幂等执行 FTS5 虚表 + 触发器 DDL，并对存量 messages 回填索引。 */
export function runFtsMigrate(db: Database.Database) {
  registerSegmentFunction(db)
  const sqlPath = join(process.cwd(), 'drizzle', '0020_fts5_messages.sql')
  const ddl = readFileSync(sqlPath, 'utf8')
  db.exec(ddl)
  // 存量回填：FTS 行数 < messages 行数时，'rebuild' 从外部内容表重建全量索引
  const ftsCount = (db.prepare("SELECT count(*) c FROM messages_fts").get() as { c: number }).c
  const msgCount = (db.prepare("SELECT count(*) c FROM messages").get() as { c: number }).c
  if (ftsCount < msgCount) {
    db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')")
  }
}
```

- [ ] **Step 5: 改 getDb() 启动跑 FTS 迁移**

Modify `src/lib/db/index.ts`：`getDb()` 在 `migrate()` 之后调用 `runFtsMigrate(db)`（注册 `segment()` 函数 + 建虚表/触发器 + 存量 rebuild）。

- [ ] **Step 6: 运行确认通过**：`npx vitest run src/__tests__/search/fts-migrate.test.ts` → PASS。

- [ ] **Step 7: Commit**

```bash
git add drizzle/0020_fts5_messages.sql src/lib/db/fts-migrate.ts src/lib/db/index.ts src/__tests__/search/fts-migrate.test.ts
git commit -m "feat(search): FTS5 external content table + triggers +存量rebuild + segment() UDF"
git push
```

---

### Task 4: 操作符解析器（Gmail 子集）

**Files:**
- Create: `src/lib/search/query-parser.ts`
- Test: `src/__tests__/search/query-parser.test.ts`

**关键设计：** 解析用户原始查询串为 `ParsedQuery { freeText: string; from?: string; to?: string; subject?: string; hasAttachment?: boolean; after?: Date; before?: Date; isUnread?: boolean; isStarred?: boolean }`。操作符语法：`from:alice`、`to:bob`、`subject:report`、`has:attachment`、`after:2024-01-01`、`before:2025-01-01`、`is:unread`、`is:starred`。带引号值：`from:"Alice Lee"`。非操作符的剩余 token 进 `freeText`。日期支持 `YYYY-MM-DD` / `YYYY/MM/DD`。非法操作符值（如 `after:foo`）忽略该操作符且把原 token 退回 freeText（不抛错，宽容解析）。

- [ ] **Step 1: 写失败测试 `src/__tests__/search/query-parser.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseQuery } from '@/lib/search/query-parser'

describe('parseQuery 操作符解析', () => {
  it('纯自由文本', () => {
    expect(parseQuery('发票 报销')).toEqual({ freeText: '发票 报销' })
  })
  it('from: 单值', () => {
    expect(parseQuery('from:alice 报告')).toEqual({ freeText: '报告', from: 'alice' })
  })
  it('from: 带引号值保留空格', () => {
    expect(parseQuery('from:"Alice Lee" hello')).toEqual({ freeText: 'hello', from: 'Alice Lee' })
  })
  it('to: subject: 同时', () => {
    expect(parseQuery('to:bob subject:report')).toEqual({ freeText: '', to: 'bob', subject: 'report' })
  })
  it('has:attachment', () => {
    expect(parseQuery('预算 has:attachment')).toEqual({ freeText: '预算', hasAttachment: true })
  })
  it('after:/before: 日期解析', () => {
    expect(parseQuery('after:2024-01-01 before:2025/01/01')).toEqual({
      freeText: '',
      after: new Date('2024-01-01T00:00:00Z'),
      before: new Date('2025-01-01T00:00:00Z'),
    })
  })
  it('is:unread / is:starred', () => {
    expect(parseQuery('is:unread')).toEqual({ freeText: '', isUnread: true })
    expect(parseQuery('is:starred')).toEqual({ freeText: '', isStarred: true })
  })
  it('非法日期 → 退回 freeText', () => {
    expect(parseQuery('after:foo')).toEqual({ freeText: 'after:foo' })
  })
  it('未知 is: 值忽略', () => {
    expect(parseQuery('is:foo')).toEqual({ freeText: 'is:foo' })
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/search/query-parser.test.ts` → FAIL。

- [ ] **Step 3: 实现 `src/lib/search/query-parser.ts`**

```ts
export interface ParsedQuery {
  freeText: string
  from?: string
  to?: string
  subject?: string
  hasAttachment?: boolean
  after?: Date
  before?: Date
  isUnread?: boolean
  isStarred?: boolean
}

const OPS = ['from', 'to', 'subject', 'has', 'after', 'before', 'is'] as const
type Op = typeof OPS[number]

/** 解析 Gmail 子集查询。带引号值整体取；无冒号或非已知操作符的 token 进 freeText。 */
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { freeText: '' }
  if (!raw) return out
  // 先按引号段切分：支持 from:"a b" 形式
  const tokens = tokenize(raw)
  const free: string[] = []
  for (const tok of tokens) {
    const m = tok.match(/^([a-zA-Z]+):(.*)$/)
    if (!m) { free.push(tok); continue }
    const [, opLowerRaw, val] = m
    const op = opLowerRaw.toLowerCase() as Op
    if (!OPS.includes(op)) { free.push(tok); continue }
    if (op === 'has') {
      if (val.toLowerCase() === 'attachment') out.hasAttachment = true
      else free.push(tok)
    } else if (op === 'is') {
      if (val === 'unread') out.isUnread = true
      else if (val === 'starred') out.isStarred = true
      else free.push(tok)
    } else if (op === 'after' || op === 'before') {
      const d = parseDate(val)
      if (d) out[op] = d
      else free.push(tok)
    } else {
      // from / to / subject
      out[op] = val
    }
  }
  out.freeText = free.join(' ').trim()
  return out
}

function tokenize(raw: string): string[] {
  const re = /("(?:[^"\\]|\\.)*"|[^\s]+)/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1])
  }
  return out
}

function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Date.UTC(+y, +mo - 1, +d))
  return isNaN(dt.getTime()) ? null : dt
}
```

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/search/query-parser.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/search/query-parser.ts src/__tests__/search/query-parser.test.ts
git commit -m "feat(search): Gmail-subset operator parser (from/to/subject/has/after/before/is)"
git push
```

---

### Task 5: FTS5 查询构造 + 搜索（MATCH + bm25 + 结构化过滤）

**Files:**
- Create: `src/lib/search/fts.ts`
- Test: `src/__tests__/search/fts.test.ts`

**关键设计：** `searchMessages(db, parsed, opts)`：
1. **MATCH 子句**：把 `freeText` + `from`/`to`/`subject` 操作符值统一 jieba 切词（`tokenizeQuery`），拼成 FTS5 列限定 MATCH：`from` → `sender:...`（FTS 列名 sender，对应 from 语义）、`to` → `"to":...`、`subject` → `subject:...`、freeText → 全列（不限定列）。多 token 用空格（FTS 默认 AND）。空查询（全空 freeText+操作符）退化为无 MATCH 的结构化过滤查询。
2. **bm25 排序**：`ORDER BY bm25(messages_fts)`（越低越相关）；列权重可调（`bm25(messages_fts, 10.0, 5.0, 5.0, 1.0, 1.0)` 给 subject/sender 高权重）。按相关性排序时用 bm25；按时间/发件人排序时改 `ORDER BY m.received_at DESC` / `m.sender`。
3. **结构化过滤**（在 JOIN messages 后加 WHERE）：`has:attachment` → `EXISTS(SELECT 1 FROM attachments WHERE message_id=m.id)`（依赖子项目 4）；`after/before` → `m.received_at >= ? / < ?`；`is:unread` → `m.is_read=0`；`is:starred` → `m.is_starred=1`；`account_id`/`folder` 二次过滤 → `m.account_id=? / m.folder=?`；固定 `m.is_deleted=0`（除非显式搜垃圾箱）。
4. SQL 用参数绑定防注入；MATCH 表达式用 `tokenizeQuery` 输出 + 白名单列名拼接（列名固定枚举，非用户输入）。

- [ ] **Step 1: 写失败测试 `src/__tests__/search/fts.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runFtsMigrate, registerSegmentFunction } from '@/lib/db/fts-migrate'
import { parseQuery } from '@/lib/search/query-parser'
import { searchMessages } from '@/lib/search/fts'

const tmp = () => `./data/test-fts-q-${process.pid}-${Date.now()}.db`

describe('searchMessages', () => {
  let path: string, db: Database.Database
  beforeEach(() => {
    path = tmp()
    db = new Database(path)
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY, message_id TEXT UNIQUE, subject TEXT, sender TEXT,
      "to" TEXT, body TEXT, body_html_text TEXT, account_id INTEGER, folder TEXT,
      received_at INTEGER, is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0
    )`)
    registerSegmentFunction(db)
    runFtsMigrate(db)
    // 三封：跨账号跨文件夹
    db.exec(`INSERT INTO messages (message_id, subject, sender, "to", body, body_html_text, account_id, folder, received_at, is_read)
             VALUES ('<a1>','季度报告','boss@acme.com','me@x.com','Q1 收入增长 发票','<p>报告正文</p>',1,'INBOX',1700000000,0),
                    ('<a2>','闲聊','friend@x.com','me@x.com','周末有空吗','hi',2,'INBOX',1700001000,1),
                    ('<a3>','季度报告2','boss@acme.com','other@x.com','Q2','<p>报告</p>',1,'Sent',1700002000,1)`)
  })
  afterEach(() => { db.close(); try { require('fs').unlinkSync(path) } catch {} })

  it('freeText 全文命中跨文件夹跨账号', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'relevance' })
    expect(r.map(x => x.messageId).sort()).toEqual(['<a1>', '<a3>'].sort())
  })

  it('from: 限定发件人', () => {
    const r = searchMessages(db, parseQuery('报告 from:boss'), { sort: 'relevance' })
    expect(r.map(x => x.messageId).sort()).toEqual(['<a1>', '<a3>'].sort())
  })

  it('from: + 账号/文件夹二次过滤', () => {
    const r = searchMessages(db, parseQuery('from:boss'), { accountId: 1, folder: 'INBOX' })
    expect(r.map(x => x.messageId)).toEqual(['<a1>'])
  })

  it('is:unread 过滤', () => {
    const r = searchMessages(db, parseQuery('is:unread'))
    expect(r.map(x => x.messageId)).toEqual(['<a1>'])
  })

  it('after:/before: 时间过滤', () => {
    const r = searchMessages(db, parseQuery('after:2023-01-01 before:2023-12-31'))
    // 1700xxx 对应 2023-11，落在区间内
    expect(r.length).toBe(3)
  })

  it('sort=time 按时间倒序', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'time' })
    expect(r[0].messageId).toBe('<a3>') // received_at 最大
  })

  it('sort=sender 按发件人', () => {
    const r = searchMessages(db, parseQuery('报告'), { sort: 'sender' })
    // 两封 sender 相同，顺序稳定即可
    expect(r.length).toBe(2)
  })

  it('空查询（无操作符无 freeText）返回全量（受 is_deleted 过滤）', () => {
    const r = searchMessages(db, parseQuery(''), { sort: 'time' })
    expect(r.length).toBe(3)
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/search/fts.test.ts` → FAIL。

- [ ] **Step 3: 实现 `src/lib/search/fts.ts`**

```ts
import type Database from 'better-sqlite3'
import type { ParsedQuery } from '@/lib/search/query-parser'
import { tokenizeQuery } from '@/lib/search/segmenter'

export type SearchSort = 'relevance' | 'time' | 'sender'

export interface SearchOpts {
  sort?: SearchSort
  accountId?: number
  folder?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface SearchHit {
  id: number
  messageId: string
  subject: string | null
  sender: string | null
  receivedAt: number | null
  isRead: number
  isStarred: number
  accountId: number | null
  folder: string | null
}

/** 主搜索入口：构造 FTS5 MATCH + 结构化条件，返回命中（已排序+分页）。 */
export function searchMessages(db: Database.Database, parsed: ParsedQuery, opts: SearchOpts = {}): SearchHit[] {
  const sort = opts.sort ?? 'relevance'
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  const where: string[] = []
  const params: (string | number)[] = []

  // MATCH 子句（仅当有可索引文本时）
  const matchExpr = buildMatchExpr(parsed)
  const hasMatch = matchExpr.length > 0

  // 结构化过滤
  if (!opts.includeDeleted) where.push('m.is_deleted = 0')
  if (opts.accountId != null) { where.push('m.account_id = ?'); params.push(opts.accountId) }
  if (opts.folder) { where.push('m.folder = ?'); params.push(opts.folder) }
  if (parsed.isUnread) where.push('m.is_read = 0')
  if (parsed.isStarred) where.push('m.is_starred = 1')
  if (parsed.after) { where.push('m.received_at >= ?'); params.push(Math.floor(parsed.after.getTime() / 1000)) }
  if (parsed.before) { where.push('m.received_at < ?'); params.push(Math.floor(parsed.before.getTime() / 1000)) }
  if (parsed.hasAttachment) {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)')
  }

  let orderBy: string
  if (sort === 'time') orderBy = 'm.received_at DESC'
  else if (sort === 'sender') orderBy = 'm.sender ASC'
  else orderBy = 'bm25(messages_fts, 12.0, 6.0, 6.0, 1.0, 1.0)'

  let sql: string
  if (hasMatch) {
    sql = `SELECT m.id, m.message_id AS messageId, m.subject, m.sender, m.received_at AS receivedAt,
                  m.is_read AS isRead, m.is_starred AS isStarred, m.account_id AS accountId, m.folder
           FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
           WHERE messages_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`
    params.unshift(matchExpr)
  } else {
    sql = `SELECT m.id, m.message_id AS messageId, m.subject, m.sender, m.received_at AS receivedAt,
                 m.is_read AS isRead, m.is_starred AS isStarred, m.account_id AS accountId, m.folder
           FROM messages m
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`
  }
  params.push(limit, offset)
  return db.prepare(sql).all(...params) as SearchHit[]
}

/** 构造 FTS5 MATCH 表达式（列限定）。列名白名单枚举，非用户输入，可安全拼接。 */
function buildMatchExpr(parsed: ParsedQuery): string {
  const parts: string[] = []
  if (parsed.subject) parts.push(`subject:${ftok(parsed.subject)}`)
  if (parsed.from) parts.push(`sender:${ftok(parsed.from)}`)
  if (parsed.to) parts.push(`"to":${ftok(parsed.to)}`)
  if (parsed.freeText) parts.push(ftok(parsed.freeText))
  return parts.join(' ').trim()
}

function ftok(s: string): string {
  // jieba 切词后，单 token 含特殊字符用双引号包裹（FTS phrase）
  const seg = tokenizeQuery(s)
  return seg.split(/\s+/).filter(Boolean).map(t => /[\s:"()-]/.test(t) ? `"${t}"` : t).join(' ')
}
```

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/search/fts.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/search/fts.ts src/__tests__/search/fts.test.ts
git commit -m "feat(search): FTS5 MATCH + bm25 + structured filters + sort/pagination"
git push
```

---

### Task 6: /api/messages GET 改走 FTS5 搜索

**Files:**
- Modify: `src/app/api/messages/route.ts`
- Test: `src/__tests__/api/search-messages.test.ts`

**关键设计：** 现有 GET 用 `like()` 走 `messages.subject/sender/body`。改为：`search`（或 `q`）参数非空时走 `parseQuery` + `searchMessages`；无搜索时保留原结构化过滤（direction/folder/account/unread/starred）。新增 query 参数：`sort`（relevance/time/sender，默认 time）、`accountId`、`folder`。跨文件夹：不传 `folder` 时跨全部文件夹搜（spec 子项目 7 核心诉求）。响应控制在 `<500ms`：FTS5 MATCH 走索引远快于 LIKE 全表扫；如需更稳，限制默认 `limit=50` + 游标分页。记录搜索历史（若查询非空且非纯操作符）。

- [ ] **Step 1: 写失败测试 `src/__tests__/api/search-messages.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
// 用注入 mock 的 searchMessages 断言 route 行为（route 用真实 db 时需集成测试）
vi.mock('@/lib/search/fts', () => ({
  searchMessages: vi.fn().mockReturnValue([
    { id: 1, messageId: '<m1>', subject: '报告', sender: 'a@x', receivedAt: 1, isRead: 0, isStarred: 0, accountId: 1, folder: 'INBOX' },
  ]),
}))
import { GET } from '@/app/api/messages/route'
import { searchMessages } from '@/lib/search/fts'

describe('GET /api/messages?q= 走 FTS5', () => {
  beforeEach(() => vi.clearAllMocks())

  it('q 非空 → 调 searchMessages，sort 默认 relevance，跨文件夹', async () => {
    const req = new Request('http://x/api/messages?q=报告&sort=relevance')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    expect(searchMessages).toHaveBeenCalled()
    const arg = (searchMessages as any).mock.calls[0][2]
    expect(arg.sort).toBe('relevance')
    expect(arg.folder).toBeUndefined() // 跨文件夹
    const body = await res.json()
    expect(body.messages.length).toBeGreaterThan(0)
  })

  it('sort=time 透传', async () => {
    await GET(new Request('http://x/api/messages?q=hi&sort=time') as any)
    expect((searchMessages as any).mock.calls[0][2].sort).toBe('time')
  })

  it('accountId/folder 透传二次过滤', async () => {
    await GET(new Request('http://x/api/messages?q=hi&accountId=2&folder=Sent') as any)
    const arg = (searchMessages as any).mock.calls[0][2]
    expect(arg.accountId).toBe(2)
    expect(arg.folder).toBe('Sent')
  })

  it('无 q → 保留原结构化过滤路径（不调 searchMessages 或调空查询）', async () => {
    const res = await GET(new Request('http://x/api/messages?direction=in') as any)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/api/search-messages.test.ts` → FAIL。

- [ ] **Step 3: 改 `src/app/api/messages/route.ts` GET**

- 读 `q = searchParams.get('q') ?? searchParams.get('search')`、`sort = searchParams.get('sort') ?? 'relevance'`、`accountId`、`folder`。
- 若 `q`（trim 后非空）：`const parsed = parseQuery(q); const hits = searchMessages(db, parsed, { sort, accountId, folder, limit: 50, offset })`；返回 `{ messages: hits }`。同时若 `parsed.freeText` 或任一操作符有效，异步记搜索历史（调 `recordSearchHistory(q)`，失败不阻塞）。
- 否则（无 q）：保留现有 direction/unread/starred 结构化逻辑（兼容旧前端）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/api/search-messages.test.ts` → PASS。

- [ ] **Step 5: 性能手测**

构造 1 万+ 邮件的库（脚本灌水或真实旧库），`time curl 'http://localhost:8321/api/messages?q=报告&sort=relevance'`。Expected: 服务端处理 `<500ms`（FTS5 索引命中）。若超 500ms，检查 FTS 是否被正确使用（`EXPLAIN QUERY PLAN` 应见 `messages_fts VIRTUAL TABLE` 而非全表扫）、`segment()` UDF 是否 deterministic。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messages/route.ts src/__tests__/api/search-messages.test.ts
git commit -m "feat(api): GET /api/messages?q= uses FTS5 search across folders/accounts (<500ms)"
git push
```

---

### Task 7: Saved Search API + 搜索历史 API

**Files:**
- Create: `src/app/api/search/saved/route.ts`、`src/app/api/search/saved/[id]/route.ts`
- Create: `src/app/api/search/history/route.ts`
- Create: `src/lib/search/history.ts`
- Test: `src/__tests__/api/search-saved.test.ts`、`src/__tests__/api/search-history.test.ts`

**关键设计：** Saved Search 与搜索历史都存 settings 表 KV（不新建表，复用 plan-01 的 key-value）：`saved_searches` → JSON 数组 `[{id, name, query, createdAt}]`；`search_history` → JSON 数组 `[{id, query, at}]`（保留最近 50 条，去重：相同 query 仅保留最新 at）。读写用 `getSetting(db, key)` / `setSetting(db, key, value)`（已有 settings 仓储，若无则在 `src/lib/db/settings.ts` 实现）。

- [ ] **Step 1: 写失败测试**

`src/__tests__/api/search-saved.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
// 用真实 in-memory db（复用测试夹具 memDb）
import { GET, POST } from '@/app/api/search/saved/route'
import { DELETE } from '@/app/api/search/saved/[id]/route'

describe('Saved Search', () => {
  beforeEach(() => resetMemDb())

  it('POST {name, query} → 200 并持久化；GET 返回列表', async () => {
    const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: '老板邮件', query: 'from:boss' }) }) as any)
    expect(r.status).toBe(200)
    const list = await (await GET(new Request('http://x') as any)).json()
    expect(list.searches.some((s: any) => s.name === '老板邮件' && s.query === 'from:boss')).toBe(true)
  })
  it('DELETE /[id] 移除指定 Saved Search', async () => {
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'n', query: 'q' }) }) as any)
    const before = await (await GET(new Request('http://x') as any)).json()
    const id = before.searches[0].id
    const r = await DELETE(new Request(`http://x/api/search/saved/${id}`) as any, { params: { id: String(id) } } as any)
    expect(r.status).toBe(200)
    const after = await (await GET(new Request('http://x') as any)).json()
    expect(after.searches.find((s: any) => s.id === id)).toBeUndefined()
  })
})
```

`src/__tests__/api/search-history.test.ts`：POST `{query}` 记录 → GET 返回历史 → 相同 query 去重仅留最新 → DELETE 清空。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `recordSearchHistory(db, query)`：读 `search_history`，过滤掉相同 query 的旧记录、unshift 新 `{id, query, at}`、截断到 50、写回。
  - `GET /api/search/saved`：读 `saved_searches` 返回 `{searches}`。`POST`：body `{name, query}` → 生成 id（`crypto.randomUUID()`）+ push → 写回 → 200。`DELETE /[id]`：按 id 过滤掉 → 200。
  - `GET /api/search/history`：返回 `{history}`。`POST`：body `{query}` → `recordSearchHistory`。`DELETE`：清空 `search_history` KV。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/search src/lib/search/history.ts src/__tests__/api/search-saved.test.ts src/__tests__/api/search-history.test.ts
git commit -m "feat(search): Saved Search + search history APIs (settings KV-backed)"
git push
```

---

### Task 8: 搜索结果页 + 搜索框 + 侧栏 Saved Search + 输入联想

**Files:**
- Create: `src/app/search/page.tsx`
- Create: `src/components/search/SearchBar.tsx`
- Create: `src/components/search/SavedSearches.tsx`
- Create: `src/components/search/SearchSuggest.tsx`
- Modify: `src/components/nav/AppShell.tsx`（顶部嵌 SearchBar）或现有顶部布局

**关键设计：**
- **SearchBar**：顶部固定，输入框支持操作符（占位提示 `搜索邮件… 使用 from: to: subject: has:attachment after: is:unread`）。输入时下拉 `SearchSuggest`：上半显示匹配的搜索历史（点选直接搜），下半显示操作符补全（输入 `fro` 提示 `from:`）。回车跳 `/search?q=...`。
- **搜索结果页 `/search`**：读 `q`/`sort` query 参数调 `/api/messages?q=`，展示结果列表（发件人/主题/时间/所属账号+文件夹标签 + body 片段高亮命中词）。顶部排序切换：时间 / 相关性 / 发件人。二次过滤条：账号下拉、文件夹下拉、`is:unread`/`is:starred` 快捷 toggle（追加到 q 重搜）。空结果有友好空状态。
- **SavedSearches**：侧栏常驻区块（在系统文件夹下方），列 Saved Search，点击跳 `/search?q=<encoded>`；每项右侧删除（小×，调 DELETE）。"+" 新建：基于当前 `/search?q=` 弹框填名字 → POST。
- **高亮**：对 freeText 的分词结果，在展示的 subject/body 片段里用 `<mark>` 包裹命中词（客户端简单 split/join，注意 XSS——只 mark 文本节点）。

- [ ] **Step 1: SearchBar + SearchSuggest**

- SearchBar：受控 input，`value` + `onChange`，debounce（150ms）拉 `/api/search/history` 过滤出联想项；下拉项点击 → `onSubmit(value)`。操作符补全：当输入末尾匹配 `/^(from|to|subject|has|after|before|is):?$/` 时，提示对应补全（如 `is:` → `unread`/`starred`）。回车或点搜索按钮 → `router.push('/search?q=' + encodeURIComponent(value))`。
- SearchSuggest：纯展示组件，props `{ historyItems: string[]; operatorHints: string[]; onPick: (s:string)=>void }`。

- [ ] **Step 2: SavedSearches**

- 客户端组件，`useEffect` 拉 `/api/search/saved`，渲染列表；点击 `router.push('/search?q=' + encodeURIComponent(s.query))`；删除按钮 `fetch DELETE` + 本地 state 移除。"+" 按钮：读 `useSearchParams().get('q')` 预填，`prompt`/弹框取 name → `POST`。

- [ ] **Step 3: 搜索结果页 `/search/page.tsx`**

- `'use client'`，`useSearchParams` 读 `q`/`sort`/`accountId`/`folder`，`useEffect` 调 `/api/messages?q=...&sort=...`，渲染列表。
- 排序切换 tab（时间/相关性/发件人）→ 更新 `sort` query 参数 → 重拉。
- 二次过滤条：账号/文件夹 `<select>`（值来自 `/api/accounts`、`/api/folders`）+ unread/starred toggle → 更新对应 query 参数。
- 结果项：展示 sender/subject/receivedAt（本地化）+ account/folder 标签 + body 片段（前 160 字，高亮 freeText 分词）。空状态文案。

- [ ] **Step 4: 嵌入 AppShell**

Modify `src/components/nav/AppShell.tsx`：顶部布局嵌 `<SearchBar />`；侧栏嵌 `<SavedSearches />`（系统文件夹区块下）。

- [ ] **Step 5: 手测**

- 顶部输 `报告` → 结果页跨文件夹/账号命中、按相关性排序。
- 输 `from:boss is:unread` → 命中 boss 未读邮件。
- 切换 时间/相关性/发件人 排序生效。
- 二次过滤选账号/文件夹收窄。
- 输入联想：历史项 + `is:` 补全。
- 新建 Saved Search "老板未读"（query `from:boss is:unread`）→ 侧栏出现 → 点击跳转命中。
- 搜索历史记录且去重；清空生效。

- [ ] **Step 6: Commit**

```bash
git add src/app/search/page.tsx src/components/search src/components/nav/AppShell.tsx
git commit -m "feat(ui): search results page + SearchBar + SavedSearches sidebar + suggestions"
git push
```

---

## 验收标准

- [ ] `messages_fts` FTS5 外部内容表存在 + 三组触发器（`messages_fts_ai/ad/au`）；INSERT/UPDATE/DELETE messages 自动同步索引（测试覆盖）。
- [ ] FTS5 索引 `subject/sender/to/body/body_html_text`，其中 `body` 为 plan-01 修复后的全文纯文本、`body_html_text` 为 body_html 去标签纯文本；历史截断邮件经 plan-01 backfill 后正文可搜。
- [ ] 中文 jieba 分词生效：`发票`/`报销` 等中文词命中（非 unicode61 整段不切）。
- [ ] `MATCH` + `bm25()` 相关性排序可用；支持 时间/相关性/发件人 三种排序。
- [ ] 搜索跨文件夹/账号（不传 folder 时全量）；`GET /api/messages?q=` 响应 `<500ms`（万级邮件实测）。
- [ ] 操作符全部生效：`from:`/`to:`/`subject:`/`has:attachment`/`after:`/`before:`/`is:unread`/`is:starred`；非法值宽容退回 freeText。
- [ ] Saved Search 常驻侧栏、可新建/删除/点击跳转；搜索历史记录+去重+清空；输入联想（历史 + 操作符补全）。
- [ ] `npm test` 全绿（segmenter / body-html-text / fts-migrate / query-parser / fts / search-messages / search-saved / search-history）。

## 依赖

- **子项目 1（硬依赖）**：messages `body` 存全文不截断（否则正文搜不全）+ drizzle 迁移框架（`body_html_text` 列靠 ALTER 增量）+ `sender/to/body_html/account_id/folder/is_read/is_starred` 列。本子项目假设这些列已就位。
- **子项目 3（硬依赖）**：messages `folder/account_id` 列 + `folders` 表，支撑跨文件夹检索与二次过滤。
- **子项目 4（软依赖）**：`has:attachment` 操作符的 `EXISTS(SELECT FROM attachments)` 依赖 attachments 表；未落地时该操作符降级为"忽略"（fts.ts 的 `parsed.hasAttachment` 分支在表缺失时不致命，或用 `attachments` 存在性探测）。

## 风险

- **jieba 跨平台构建**：选 `@node-rs/jieba`（Rust napi 预编译二进制，免 node-gyp）规避 `nodejieba` 的编译风险；但仍需确认目标平台（macOS arm64/x64、Linux x64/arm64）预编译可用。若某平台无二进制，降级方案：写入/查询前用纯 JS 的 `intl-segmenter`（Node 内置 `Intl.Segmenter`，Node 16+ 支持中文）切词——`segmenter.ts` 抽象接口便于替换实现。
- **触发器同步对入库延迟的放大**：每封邮件 INSERT/UPDATE 触发 5 次 `segment()` JS 函数调用（better-sqlite3 JS UDF 走同步桥），大邮件/批量入库会变慢。对策：① 批量入库（IMAP 同步）用单事务包裹（触发器在事务内累积、提交时一次性执行，减少 JS↔C 桥往返）；② 监控入库耗时，必要时对超大批量先 `INSERT INTO messages_fts(messages_fts) VALUES('delete-all')` + 事后 `'rebuild'`。
- **FTS5 "delete" 命令对外部内容表的列值要求**：AD/AU 触发器必须提供全部列的 OLD 原始值，缺列会导致删除失败（FTS5 抛错）。列名/列数必须与虚表定义 + messages 真实列三方严格一致（`subject/sender/to/body/body_html_text`）——本计划的 DDL 已对齐；后续若 messages 增删被索引列，必须同步改虚表定义 + 触发器。
- **segment() UDF 注册时机**：`runFtsMigrate` 在 `getDb()` 启动时注册，确保后续所有 messages 写入（同步引擎、发送、回填）触发器调用 `segment()` 时函数已存在；若测试或脚本直接 `new Database()` 跳过 getDb()，必须显式 `registerSegmentFunction(db)`（测试夹具已做）。
- **MATCH 注入**：MATCH 表达式由 `tokenizeQuery` 输出 + 固定列名枚举拼接，列名非用户输入；单 token 含 FTS 特殊字符（`"`/`:`/`(`）时用双引号包裹成 phrase（`ftok` 已处理）。仍需在 Task 5 测试中加边界用例（查询含引号/冒号）防绕过。
- **性能回归**：若历史 LIKE 查询残留（部分前端组件未切到 `q=`），需确保 `/api/messages` 无 `search=` 时仍走老路径但 `search=` 与 `q=` 等价，避免双路径维护漂移。
