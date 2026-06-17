# 子项目 4 — 附件系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 补全附件收发全链路——接收解析 MIME multipart 逐附件按 sha256 落盘（保留 Content-ID 内联）、sender 加 `attachments` 参数、ComposeMail 文件选择器/拖拽/粘贴截图转内联、列表 + 图片/PDF 预览 + 强制下载、大小上限 + 流式解析 + 路径穿越防护、预留病毒扫描钩子。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 4）。本地单机、附件内容寻址落盘 `attachments/{accountId}/{messageId}/{sha256}.bin`，sha256 去重（引用计数，删邮件级联减引用、归零才删文件）；receiver 用流式 MIME 解析（mailparser）逐附件算 sha256 写盘，保留 `content_id` 供内联渲染；sender 经 nodemailer `attachments`（含内联 CID）；收件 HTML 内联 `cid:` 在渲染时替换为本地 blob URL。单附件/单邮件大小上限防 OOM；filename 清洗防路径穿越；预留病毒扫描钩子接口（默认 no-op）。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / mailparser / TipTap 3 / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 1（迁移框架 + messages.account_id）与子项目 2（ImapAdapter、SendParams.attachments 已定义）。阶段 1 执行——执行前补全 TDD 微步骤。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — `attachments` 表（Task 1）
- Create: `src/lib/attachments/repo.ts` — attachments 表读写 + 引用计数
- Create: `src/lib/attachments/store.ts` — 落盘/读取/删除（sha256 内容寻址 + 路径穿越防护 + 引用计数 GC）
- Create: `src/lib/attachments/extract.ts` — mailparser 流式解析 MIME multipart → 逐附件落盘（含 Content-ID）
- Create: `src/lib/attachments/scan-hook.ts` — 病毒扫描钩子接口（默认 no-op）
- Create: `src/lib/attachments/sanitize.ts` — filename 清洗 + size 限制 + ZIP 炸弹检测
- Modify: `src/lib/adapter/mail/imapAdapter.ts` — receiver 流程接 extract；send 已支持 attachments（plan-02 Task 8）
- Create: `src/app/api/messages/[id]/attachments/route.ts` — GET 列表附件
- Create: `src/app/api/messages/[id]/attachments/[aid]/route.ts` — GET 下载（强制 `Content-Disposition: attachment`）+ 内联图片 serve
- Create: `src/app/api/upload/route.ts` — 撰写时上传待发附件（落盘临时区，返回 id/sha256）
- Modify: `src/components/ComposeMail.tsx` — 文件选择器 + 拖拽 + 粘贴截图转内联 CID
- Modify: `src/components/RichTextEditor.tsx` — 内联图片插入（上传 → cid）
- Create: `src/components/AttachmentList.tsx` — 附件列表（按 mimeType 图标）+ 预览（图片/PDF）+ 强制下载
- Test: `src/__tests__/attachments/store.test.ts`、`src/__tests__/attachments/sanitize.test.ts`、`src/__tests__/attachments/extract.test.ts`、`src/__tests__/attachments/repo.test.ts`、`src/__tests__/api/attachments.test.ts`、`src/__tests__/api/upload.test.ts`

---

## 任务

### Task 1: attachments 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 加 attachments 表**

```ts
export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  messageId: integer('message_id').notNull(),     // messages.id 外键
  filename: text('filename').notNull(),            // 清洗后
  mimeType: text('mime_type'),
  size: integer('size').notNull(),
  contentId: text('content_id'),                   // MIME Content-ID（内联用，可空）
  isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
  storagePath: text('storage_path').notNull(),     // 相对根的 sha256 内容寻址路径
  sha256: text('sha256').notNull(),
  downloadedAt: integer('downloaded_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  msgIdx: index('idx_attachments_message').on(t.messageId),
  shaIdx: index('idx_attachments_sha').on(t.sha256),
}))
```

- [ ] **Step 2: 生成迁移** `npm run db:generate`。

- [ ] **Step 3: 迁移测试** `npx vitest run src/__tests__/db/migration.test.ts` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): attachments table (content-addressed sha256)"
git push
```

---

### Task 2: filename 清洗 + size 限制 + ZIP 炸弹检测

**Files:**
- Create: `src/lib/attachments/sanitize.ts`
- Test: `src/__tests__/attachments/sanitize.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeFilename, isWithinSizeLimit, isZipBombRisk } from '@/lib/attachments/sanitize'

describe('附件安全', () => {
  it('剥离路径穿越 ../ 与绝对路径', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('/etc/shadow')).toBe('shadow')
    expect(sanitizeFilename('a/../../b.txt')).toBe('b.txt')
  })
  it('控制字符/空名兜底', () => {
    expect(sanitizeFilename('')).toBe('attachment')
    expect(sanitizeFilename('   ')).toBe('attachment')
    expect(sanitizeFilename('a\x00b.txt')).toBe('ab.txt')
  })
  it('保留正常多语言名', () => {
    expect(sanitizeFilename('报告.pdf')).toBe('报告.pdf')
  })
  it('isWithinSizeLimit', () => {
    expect(isWithinSizeLimit(25 * 1024 * 1024, { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 })).toBe(true)
    expect(isWithinSizeLimit(25 * 1024 * 1024 + 1, { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 })).toBe(false)
  })
  it('ZIP 炸弹检测：压缩比 > 100 标记风险', () => {
    expect(isZipBombRisk({ compressedSize: 1024, uncompressedSize: 200 * 1024 })).toBe(true)
    expect(isZipBombRisk({ compressedSize: 1024, uncompressedSize: 50 * 1024 })).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - `sanitizeFilename(name)`：取 basename（`path.basename` 在 posix 分隔下仍可能放过反斜杠，故先把 `\` 归一为 `/` 再取末段）→ 去控制字符（`\x00-\x1f`）→ strip → 空则 `'attachment'`。
  - `isWithinSizeLimit(size, { perAttachment, perMessage })`。
  - `isZipBombRisk({ compressedSize, uncompressedSize })`：`uncompressedSize / compressedSize > 100` 风险（用于 zip 类型附件解压前的预检）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments/sanitize.ts src/__tests__/attachments/sanitize.test.ts
git commit -m "feat(attachments): filename sanitization + size limit + zip-bomb detection"
git push
```

---

### Task 3: sha256 内容寻址 store + 引用计数 + 路径穿越防护

**Files:**
- Create: `src/lib/attachments/store.ts`
- Test: `src/__tests__/attachments/store.test.ts`

**关键设计：** 落盘路径 `attachments/{accountId}/{messageId}/{sha256}.bin`。`store(buf, {accountId, messageId})` 算 sha256 → 校验落盘路径不逃出 `attachments/{accountId}/{messageId}/`（path traversal 防护：resolved path 必须 startswith 允许目录）→ 写盘（已存在则跳过写，引用计数在 DB 层）。删邮件时 `releaseByMessage(messageId)`：删 attachments 行，对每个 sha256 若无其他行引用则 unlink 文件。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { storeContent, resolveSafePath, releaseByMessage, readStream } from '@/lib/attachments/store'

describe('附件落盘 store', () => {
  it('resolveSafePath 拒绝路径穿越', () => {
    expect(() => resolveSafePath({ accountId: 1, messageId: 1, sha256: '../../etc/x' }))
      .toThrow(/traversal|escape/i)
  })
  it('storeContent 按 sha256 落盘并返回路径，相同内容不重写', async () => {
    const buf = Buffer.from('hello')
    const p1 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 1 })
    const p2 = await storeContent(tmpRoot(), buf, { accountId: 1, messageId: 2 })
    expect(p1).toContain('attachments/1/1/')
    expect(p1.endsWith('.bin')).toBe(true)
    expect(p2).toContain('attachments/1/2/')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - `resolveSafePath({ accountId, messageId, sha256 })`：构造 `attachments/{accountId}/{messageId}/{sha256}.bin`，`path.resolve` 后断言 `startsWith(path.resolve(root, 'attachments', String(accountId), String(messageId)) + sep)`，否则 throw（防 sha256/路径注入穿越）。
  - `storeContent(root, buf, {accountId, messageId})`：`sha256(buf)` → `resolveSafePath` → `!exists ? mkdirp+writeFile` : skip。
  - `readStream(root, storagePath)`：返回可读流（下载/预览用）。
  - `releaseByMessage(db, root, messageId)`：查 attachments 行 → 逐 sha256 `count WHERE sha256=?` → 仅当为 1（当前行）时 unlink → 删行。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments/store.ts src/__tests__/attachments/store.test.ts
git commit -m "feat(attachments): sha256 content store + refcount GC + traversal guard"
git push
```

---

### Task 4: MIME multipart 流式解析 extract（含 Content-ID）+ 病毒扫描钩子

**Files:**
- Create: `src/lib/attachments/extract.ts`
- Create: `src/lib/attachments/scan-hook.ts`
- Test: `src/__tests__/attachments/extract.test.ts`

- [ ] **Step 1: 写失败测试（用 mailparser 构造含内联 + 外联附件的邮件）**

```ts
import { describe, it, expect, vi } from 'vitest'
import { extractAttachments } from '@/lib/attachments/extract'

describe('extractAttachments', () => {
  it('解析出 inline(含 cid) 与 attachment 两类，逐个落盘 + 记表', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true })
    const raw = buildMime({ // helper: 一张内联图(contentId=<img1>) + 一个 pdf 外联
      inline: { filename: 'logo.png', cid: '<img1>', mime: 'image/png', data: Buffer.from([1,2,3]) },
      attach: { filename: 'doc.pdf', mime: 'application/pdf', data: Buffer.from([4,5,6]) },
    })
    const result = await extractAttachments(raw, { accountId: 1, messageId: 1, root: tmpRoot(), db: memDb(), scan })
    expect(result).toHaveLength(2)
    expect(result.find(a => a.contentId)).toMatchObject({ filename: 'logo.png', isInline: true, contentId: '<img1>' })
    expect(result.find(a => !a.contentId)).toMatchObject({ filename: 'doc.pdf', isInline: false })
    expect(scan).toHaveBeenCalledTimes(2) // 钩子对每附件调用
  })

  it('超 perAttachment 上限的附件跳过下载但记表(size 标记、storagePath 空、flag)', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024)
    const raw = buildMime({ attach: { filename: 'big.bin', mime: 'application/octet-stream', data: big } })
    const result = await extractAttachments(raw, { accountId: 1, messageId: 1, root: tmpRoot(), db: memDb(), limits: { perAttachment: 25 * 1024 * 1024, perMessage: 50 * 1024 * 1024 } })
    expect(result[0].storagePath).toBeNull()
    expect(result[0].size).toBe(big.length)
  })

  it('scan 钩子返回 ok:false → 标记但不阻断', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: false, reason: 'EICAR' })
    const raw = buildMime({ attach: { filename: 'x.txt', mime: 'text/plain', data: Buffer.from('z') } })
    const result = await extractAttachments(raw, { accountId: 1, messageId: 1, root: tmpRoot(), db: memDb(), scan })
    expect(result[0].scanStatus).toBe('flagged')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - `scan-hook.ts`：`export interface ScanHook { scan(buf: Buffer, meta: {filename, mimeType}): Promise<{ok: boolean; reason?: string}> }`；`export const NOOP_SCAN: ScanHook = { scan: async () => ({ ok: true }) }`。预留真实实现位（子项目 11 落地 ClamAV/本地签名）。
  - `extractAttachments(rawSource, { accountId, messageId, root, db, scan=NOOP_SCAN, limits })`：用 `mailparser.simpleParser`（流式）解析 → `mail.attachments` 数组每项 `{ filename, contentType, content(Buffer), contentDisposition, cid }`；`isInline = contentDisposition === 'inline' || !!cid`；`filename = sanitizeFilename(filename)`；`size = content.length`；超 `limits.perAttachment` → 落表不落盘（`storagePath=null`、`overSizeLimit=true`）；否则 `sha256(content)` + `storeContent` → 落表（含 contentId/isInline/storagePath/sha256/mimeType/size）；调 `scan.scan(content,...)` → `scanStatus: 'ok'|'flagged'`。返回落表行。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments/extract.ts src/lib/attachments/scan-hook.ts src/__tests__/attachments/extract.test.ts
git commit -m "feat(attachments): streaming MIME extract with cid + scan hook + size guard"
git push
```

---

### Task 5: repo（attachments 表读写 + 列表/引用计数）

**Files:**
- Create: `src/lib/attachments/repo.ts`
- Test: `src/__tests__/attachments/repo.test.ts`

- [ ] **Step 1: 写失败测试**：`listByMessage(db, messageId)` 返回行（inline 与 attachment 分组字段）；`releaseByMessage` 删行 + 仅 sha256 无引用时 unlink（注入 fs mock 断言 unlink 次数 = 独占 sha 数）；`markScanFlag(db, id, reason)`。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：CRUD + `listByMessage`、`releaseByMessage`（调用 store.releaseByMessage）、`countBySha256`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments/repo.ts src/__tests__/attachments/repo.test.ts
git commit -m "feat(attachments): repo with refcount-aware release"
git push
```

---

### Task 6: receiver/sender 接线（extract 入 receive 流程；send 透传 attachments）

**Files:**
- Modify: `src/lib/adapter/mail/imapAdapter.ts`

- [ ] **Step 1: receiver 接线**：`fetch` 解析每封后调 `extractAttachments(raw, {accountId, messageId, root, db})`（`raw` 取 ImapFlow `source` 完整 MIME）；`messageId` 用入库后的 messages.id。失败不阻断邮件入库（记日志）。

- [ ] **Step 2: sender 接线**：plan-02 Task 8 已使 `send(params)` 透传 `attachments`（含 `cid` 内联）到 nodemailer。确认 `SendParams.attachments` 项 `{filename, path?, content?, cid?}` 映射到 nodemailer `attachments: [{filename, path, content, cid, contentDisposition: cid ? 'inline' : 'attachment'}]`。补单测断言内联项 `contentDisposition:'inline'`、外联项默认 attachment。

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapter/mail/imapAdapter.ts src/__tests__/adapter/imapAdapter.test.ts
git commit -m "feat(adapter): wire attachment extract in receive + inline/attach in send"
git push
```

---

### Task 7: 下载 + 列表 API（强制 Content-Disposition + 内联 serve）

**Files:**
- Create: `src/app/api/messages/[id]/attachments/route.ts`、`src/app/api/messages/[id]/attachments/[aid]/route.ts`
- Test: `src/__tests__/api/attachments.test.ts`

- [ ] **Step 1: 写失败测试**
  - `GET /api/messages/5/attachments` → 返回附件列表（filename/size/mimeType/isInline）。
  - `GET /api/messages/5/attachments/9` → 响应 `Content-Disposition: attachment; filename="..."`（强制下载，RFC2047 编码非 ASCII 名）、`Content-Type` 正确、body 为文件内容流。
  - `?inline=1` → `Content-Disposition: inline`（内联图片渲染用）。
  - `storagePath` 为空（超限未落盘）→ 404 + body `{error:'not_downloaded'}`。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - 列表路由：`repo.listByMessage`。
  - 下载路由：查行 → `store.readStream` → 设 `Content-Type`、`Content-Length`、`Content-Disposition`（默认 attachment，`?inline=1` → inline；filename 用 RFC2047 `encoded-word`/RFC5987 `filename*=UTF-8''...` 处理非 ASCII）→ `Response` 流式返回。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messages src/__tests__/api/attachments.test.ts
git commit -m "feat(api): attachment list + forced-download + inline serve"
git push
```

---

### Task 8: 撰写上传 API（待发临时落盘）

**Files:**
- Create: `src/app/api/upload/route.ts`
- Test: `src/__tests__/api/upload.test.ts`

- [ ] **Step 1: 写失败测试**：`POST /api/upload`（multipart，含 file）→ 落盘到临时区 `attachments/tmp/{sha256}.bin` + 返回 `{id, filename, size, mimeType, sha256, storagePath, cid?}`；超 `perAttachment` → 413；filename 含 `../` → 清洗后 basename。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：Next.js Route Handler 解析 multipart（`request.formData()`）→ `sanitizeFilename` → size 校验 → `storeContent(tmpRoot,...)` → 返回元数据。粘贴截图走同一端点，body 标 `isInline=true` 生成 `cid`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload/route.ts src/__tests__/api/upload.test.ts
git commit -m "feat(api): compose upload endpoint with size limit + sanitization"
git push
```

---

### Task 9: ComposeMail 文件选择器 + 拖拽 + 粘贴截图转内联

**Files:**
- Modify: `src/components/ComposeMail.tsx`、`src/components/RichTextEditor.tsx`

- [ ] **Step 1: ComposeMail**：加"添加附件"按钮（`<input type=file multiple>`）、拖拽区（onDrop 收集文件）、粘贴（onPaste 检测 image/* → 上传 + 插入内联 `<img src="cid:...">`）。维护待发附件列表 state（filename/size/storagePath/cid/isInline）。发送时组装进 `SendParams.attachments`（外联给 `path`，内联给 `content`/`cid`）。显示已选附件列表 + 单个移除。

- [ ] **Step 2: RichTextEditor**：粘贴/拖入图片时调 `/api/upload` 拿 cid → 插入 `<img src="cid:<id>">` 节点。

- [ ] **Step 3: 手测**：粘贴截图在编辑器内联显示；选 pdf 发出后收方有附件。

- [ ] **Step 4: Commit**

```bash
git add src/components/ComposeMail.tsx src/components/RichTextEditor.tsx
git commit -m "feat(compose): file picker + drag-drop + paste-screenshot inline attachments"
git push
```

---

### Task 10: AttachmentList 列表 + 图片/PDF 预览 + 强制下载 UI

**Files:**
- Create: `src/components/AttachmentList.tsx`
- Modify: `src/app/mails/[id]/page.tsx`（邮件详情挂载 AttachmentList）

- [ ] **Step 1: 实现 AttachmentList**：从 `/api/messages/[id]/attachments` 渲染附件项——按 mimeType 显示图标（image/pdf/doc/zip/通用）；图片点击 lightbox 预览（`?inline=1`）；PDF 用 `<iframe>`/viewer 预览；其他点"下载"走强制下载路由；超限未落盘项显示"过大未下载"占位；scan flagged 项标警告。

- [ ] **Step 2: 手测**：收一封带图片+pdf 的邮件，预览/下载正常；内联图片在正文 cid 位置渲染。

- [ ] **Step 3: 内联 cid 渲染**：EmailBody 渲染 bodyHtml 前，把 `cid:<id>` 替换为 `/api/messages/[id]/attachments/[aid]?inline=1`（DOMPurify 净化后，与子项目 11 协同）。

- [ ] **Step 4: Commit**

```bash
git add src/components/AttachmentList.tsx src/app/mails/[id]/page.tsx
git commit -m "feat(ui): attachment list + image/pdf preview + inline cid render"
git push
```

---

## 验收标准

- [ ] 收带附件的邮件：附件逐个按 sha256 落盘、attachments 表行齐全、Content-ID 保留、内联图片在正文正确渲染。
- [ ] 发邮件带附件：收件方收到；粘贴截图为内联 cid 图片。
- [ ] 列表显示附件（图标 + 大小）；图片可预览、PDF 可预览、强制下载 `Content-Disposition: attachment`。
- [ ] sha256 去重：同一内容不重写；删邮件后无引用的文件被 GC、有引用的保留。
- [ ] 安全：filename 含 `../`/绝对路径/控制字符被清洗；超 perAttachment 附件不落盘不 OOM；ZIP 炸弹可检测；病毒扫描钩子可插拔（默认 no-op）。
- [ ] `npm test` 全绿。

## 依赖

- 子项目 1（迁移框架 + messages.account_id）。
- 子项目 2（ImapAdapter、`SendParams.attachments`、getAdapter）。
- DOMPurify 净化（spec §2.4，内联 cid 替换前需净化；与子项目 11 协同）。

## 风险

- **大附件内存**：必须用 mailparser 流式解析 + `ImapFlow` `fetch source`，禁一次性 `Buffer.concat` 全部 part。
- **sha256 多邮件引用 + 安全删除**：引用计数必须正确，否则孤立文件占盘或误删共享文件（Task 3/5）。
- **路径穿越**：sha256/accountId/messageId 均为外部/半外部输入，`resolveSafePath` 必须 startswith 校验（Task 3）。
- **ZIP 炸弹**：解压前预检压缩比（Task 2），默认不解压高危压缩包预览。
- execute 前补全每个任务的 TDD 微步骤。
