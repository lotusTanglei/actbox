# 子项目 5 — 收发补全：CC/BCC/转发/草稿续编/签名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 补齐 compose/send 侧——messages 的 to/cc/bcc 拆列；sender 透传 cc/bcc；ComposeMail 可折叠 CC/BCC；`/api/draft/[id]` PATCH 续编；编辑器 debounced(≤10s) 自动保存；按 accountId 加载并自动追加签名；转发（引用原文 + Auto-Submitted/References 头）；收件人智能校验（外部域提醒、"提到附件但未添加"检测）。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 5）。本地单机。messages 的 to/cc/bcc 各为独立列（子项目 1 已加），recipient 旧列保留兼容并回填到 to。sender 经 `SendParams`(含 `cc`/`bcc`/`inReplyTo`/`replyToMessageId`/`attachments`) 透传到 nodemailer；转发构造 `Auto-Submitted: auto-replied` + `References`/`In-Reply-To` 头。草稿用 messages `direction='draft'` + PATCH 续编（不丢内容）；编辑器 debounced 自动保存 ≤10s 写回草稿行。签名按 accountId 从 settings 取并在编辑层自动追加（非 sender）。收件人校验在 compose 前置。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / TipTap 3 / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。依赖子项目 1（messages `to/cc/bcc` 列 + 全文 body）与子项目 2（`SendParams`/`ImapAdapter.send`）。阶段 1 执行——执行前补全 TDD 微步骤。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — 确认 to/cc/bcc 列存在（子项目 1）；recipient → to 回填迁移（Task 1）
- Create: `src/lib/mail/recipients.ts` — 收件人解析/校验（拆列、外部域提醒、附件检测）
- Modify: `src/lib/adapter/mail/imapAdapter.ts` — send 透传 cc/bcc + 转发头（plan-02 已透传，此处补转发头与断言）
- Modify: `src/app/api/send/route.ts` — 接收 cc/bcc/forward，校验后 send；回填 to
- Modify: `src/app/api/draft/route.ts` — 现有 POST 创建草稿
- Create: `src/app/api/draft/[id]/route.ts` — PATCH 续编 / DELETE / GET
- Create: `src/lib/mail/signature.ts` — 按 accountId 取签名（settings）
- Create: `src/lib/mail/forward.ts` — 构造转发引用原文 + 头
- Modify: `src/components/ComposeMail.tsx` — 可折叠 CC/BCC、签名注入、转发模式、收件人校验提示、发送组装
- Modify: `src/components/RichTextEditor.tsx` — debounced 自动保存（≤10s）onChange 回调
- Create: `src/components/RecipientFields.tsx` — To/Cc/Bcc 输入 + 自动补全 + 外部域提醒
- Test: `src/__tests__/mail/recipients.test.ts`、`src/__tests__/mail/forward.test.ts`、`src/__tests__/mail/signature.test.ts`、`src/__tests__/api/send-cc-bcc.test.ts`、`src/__tests__/api/draft.test.ts`

---

## 任务

### Task 1: recipient → to 回填 + 确认 to/cc/bcc 列

**Files:**
- Modify: `src/lib/db/schema.ts`（确认列）/ Create 回填脚本片段
- Test: `src/__tests__/db/migration.test.ts`（补充）

- [ ] **Step 1: 确认 schema.ts messages 含 to/cc/bcc**（子项目 1 已加 `to('to')`/`cc('cc')`/`bcc('bcc')` + 旧 `recipient`）。若仍为旧 `recipient` 单列，确保 plan-01 Task 3 的扩列已并入。

- [ ] **Step 2: 写回填测试**

```ts
import { describe, it, expect } from 'vitest'
import { backfillRecipientToTo } from '@/lib/db/backfill-runner'

describe('recipient → to 回填', () => {
  it('to 为空且 recipient 有值的行回填到 to', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, recipient, direction) VALUES ('<m1>', 'a@x,b@y', 'out'),('<m2>', null, 'out')`)
    const stats = backfillRecipientToTo(db)
    expect(stats.refilled).toBe(1)
    expect((db.prepare("SELECT to FROM messages WHERE message_id='<m1>'").get() as any).to).toBe('a@x,b@y')
    const stats2 = backfillRecipientToTo(db)
    expect(stats2.refilled).toBe(0) // 幂等
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 backfillRecipientToTo**：`UPDATE messages SET to = recipient WHERE (to IS NULL OR to='') AND recipient IS NOT NULL`，返回影响行数。幂等（to 已有值不动）。

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/backfill-runner.ts src/__tests__/db/migration.test.ts
git commit -m "feat(db): backfill legacy recipient column into to"
git push
```

---

### Task 2: 收件人解析与校验（外部域提醒 + 附件检测）

**Files:**
- Create: `src/lib/mail/recipients.ts`
- Test: `src/__tests__/mail/recipients.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { splitAddresses, validateRecipients, detectAttachmentMention, findExternalDomains } from '@/lib/mail/recipients'

describe('收件人处理', () => {
  it('splitAddresses 按逗号/分号拆并 trim，过滤空', () => {
    expect(splitAddresses('a@x.com, b@y.com; ,')).toEqual(['a@x.com', 'b@y.com'])
  })
  it('validateRecipients 标非法地址', () => {
    expect(validateRecipients(['a@x.com', 'not-email', 'b@y.com'])).toEqual({ valid: ['a@x.com', 'b@y.com'], invalid: ['not-email'] })
  })
  it('findExternalDomains 对比账号自有域标外部', () => {
    expect(findExternalDomains(['cowork@a.com', 'stranger@evil.com'], ['a.com'])).toEqual(['stranger@evil.com'])
  })
  it('detectAttachmentMention 文本提到附件但列表空 → true', () => {
    expect(detectAttachmentMention('见附件', [])).toBe(true)
    expect(detectAttachmentMention('见附件', [{filename:'a.pdf'}])).toBe(false)
    expect(detectAttachmentMention('hello', [])).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - `splitAddresses(s)`：按 `,`/`;` 拆 + trim + 去空。
  - `validateRecipients(addrs)`：正则校验 RFC 简化邮箱，分 valid/invalid。
  - `findExternalDomains(addrs, ownDomains)`：域名不在 ownDomains 的列外部。
  - `detectAttachmentMention(text, attachments)`：文本含关键词（附件/attachment/attached/见附件/enclosed）且 attachments 为空 → true。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/recipients.ts src/__tests__/mail/recipients.test.ts
git commit -m "feat(mail): recipient parse/validate + external-domain + attachment-mention checks"
git push
```

---

### Task 3: 签名按 accountId 加载

**Files:**
- Create: `src/lib/mail/signature.ts`
- Test: `src/__tests__/mail/signature.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { getSignatureForAccount } from '@/lib/mail/signature'

describe('签名加载', () => {
  it('按 accountId 取专用签名，缺省回落全局签名', () => {
    const db = memDb()
    putSetting(db, 'signature', 'Global sig')
    putSetting(db, 'signature:1', 'Account1 sig')
    expect(getSignatureForAccount(db, 1)).toBe('Account1 sig')
    expect(getSignatureForAccount(db, 2)).toBe('Global sig') // 无专用回落全局
  })
  it('无任何签名返回空串', () => {
    expect(getSignatureForAccount(memDb(), 1)).toBe('')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 getSignatureForAccount(db, accountId)`：先查 settings `signature:{accountId}`，空则查 `signature`，再空返回 `''`。签名 HTML 存 settings（key value 文本，编辑层负责把 HTML 插入编辑器）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/signature.ts src/__tests__/mail/signature.test.ts
git commit -m "feat(mail): per-account signature with global fallback"
git push
```

---

### Task 4: 转发构造（引用原文 + 头）

**Files:**
- Create: `src/lib/mail/forward.ts`
- Test: `src/__tests__/mail/forward.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { buildForward } from '@/lib/mail/forward'

describe('buildForward', () => {
  it('引用原文块 + Forward 头', () => {
    const src = { messageId: '<orig>', subject: 'Hi', from: 'a@x.com', to: 'b@y.com', body: 'Hello', receivedAt: new Date('2026-06-17T00:00:00Z') }
    const out = buildForward(src, { accountId: 1 })
    expect(out.subject).toBe('Fwd: Hi')
    expect(out.body).toContain('Hello')
    expect(out.body).toContain('-----原始邮件-----') // 引用头
    expect(out.headers?.['Auto-Submitted']).toBe('auto-replied')
    expect(out.headers?.['References']).toContain('<orig>')
    expect(out.headers?.['In-Reply-To']).toBe('<orig>')
  })
  it('无 messageId 时头不崩', () => {
    const out = buildForward({ messageId: '', subject: 's', from: 'a', to: 'b', body: 'x', receivedAt: null }, { accountId: 1 })
    expect(out.headers).toBeDefined()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 buildForward(src, {accountId})`：返回 `{ subject: 'Fwd: ' + (已含 Fwd: ? 跳过) , body: 引用块(含 -----原始邮件-----/发件人/收件人/时间/主题 + 原文), headers: { 'Auto-Submitted':'auto-replied', 'References': src.messageId, 'In-Reply-To': src.messageId } }`。subject 已以 `Fwd:/Fw:` 开头则不再叠加。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/forward.ts src/__tests__/mail/forward.test.ts
git commit -m "feat(mail): forward quoting + Auto-Submitted/References headers"
git push
```

---

### Task 5: send 路由透传 cc/bcc + 转发 + 校验

**Files:**
- Modify: `src/app/api/send/route.ts`
- Test: `src/__tests__/api/send-cc-bcc.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'

describe('POST /api/send cc/bcc/forward', () => {
  it('透传 cc/bcc 到 adapter.send 并入库 to/cc/bcc', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<out>' })
    const res = await callRoute('POST', '/api/send', { accountId: 1, to: 'b@y', cc: 'c@z', bcc: 'd@w', subject: 's', body: 't', bodyHtml: '<p>t</p>' }, { send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@y', cc: 'c@z', bcc: 'd@w' }))
    expect(res.status).toBe(200)
    const row = querySendRow()
    expect(row).toMatchObject({ to: 'b@y', cc: 'c@z', bcc: 'd@w', direction: 'out' })
  })
  it('非法收件人 → 400', async () => {
    const res = await callRoute('POST', '/api/send', { accountId: 1, to: 'not-email', subject: 's', body: 't' }, { send: vi.fn() })
    expect(res.status).toBe(400)
    expect(res.body.invalid).toEqual(['not-email'])
  })
  it('forward:true 用 buildForward 头', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<out>' })
    await callRoute('POST', '/api/send', { accountId: 1, to: 'b@y', subject: 's', body: 't', forwardOfMessageId: '<orig>' }, { send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({ 'Auto-Submitted': 'auto-replied' }) }))
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：`POST /api/send` 接 `{accountId, to, cc, bcc, subject, body, bodyHtml, attachments, forwardOfMessageId?, replyToMessageId?}`。流程：`validateRecipients(splitAddresses(to)+cc+bcc)` → 有 invalid 返回 400 `{invalid}` → 若 `forwardOfMessageId` 取源邮件 → `buildForward` 合并 subject/body/headers → `getAdapter(accountId).send(params)` → 入库 messages(`direction:'out'`, to/cc/bcc/body/bodyHtml/accountId)。不再截断 body（子项目 1 已修）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/send/route.ts src/__tests__/api/send-cc-bcc.test.ts
git commit -m "feat(api): send with cc/bcc + forward headers + recipient validation"
git push
```

---

### Task 6: 草稿 PATCH 续编 / GET / DELETE

**Files:**
- Create: `src/app/api/draft/[id]/route.ts`
- Modify: `src/app/api/draft/route.ts`（POST 创建确认返回 id）
- Test: `src/__tests__/api/draft.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'

describe('draft CRUD', () => {
  it('POST 创建草稿返回 id（direction=draft）', async () => {
    const res = await callRoute('POST', '/api/draft', { accountId: 1, subject: 's', body: 'b' })
    expect(res.body.id).toBeGreaterThan(0)
    const row = queryDraft(res.body.id)
    expect(row.direction).toBe('draft')
  })
  it('PATCH 续编不丢字段（to/cc/bcc/body/bodyHtml 全量覆盖）', async () => {
    const id = await createDraft({ subject: 's', body: 'b' })
    const res = await callRoute('PATCH', `/api/draft/${id}`, { to: 'b@y', cc: 'c@z', subject: 's2', body: 'b2', bodyHtml: '<p>2</p>' })
    expect(res.status).toBe(200)
    const row = queryDraft(id)
    expect(row).toMatchObject({ to: 'b@y', cc: 'c@z', subject: 's2', body: 'b2', body_html: '<p>2</p>' })
  })
  it('GET /api/draft/[id] 返回草稿全字段', async () => {
    const id = await createDraft({ subject: 's' })
    const res = await callRoute('GET', `/api/draft/${id}`)
    expect(res.body.id).toBe(id)
  })
  it('DELETE /api/draft/[id] 删除草稿', async () => {
    const id = await createDraft({ subject: 's' })
    await callRoute('DELETE', `/api/draft/${id}`)
    expect(queryDraft(id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：
  - `POST /api/draft`：建 messages `direction='draft'`，返回 id。
  - `PATCH /api/draft/[id]`：全量覆盖 to/cc/bcc/subject/body/bodyHtml（不传字段保持原值；前端每次 PATCH 传全量）→ 200。只允许 `direction='draft'` 的行。
  - `GET /api/draft/[id]`：返回草稿全字段。
  - `DELETE /api/draft/[id]`：物理删草稿行。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/draft/route.ts src/app/api/draft/[id]/route.ts src/__tests__/api/draft.test.ts
git commit -m "feat(api): draft PATCH/GET/DELETE for continuous editing"
git push
```

---

### Task 7: RichTextEditor debounced 自动保存（≤10s）

**Files:**
- Modify: `src/components/RichTextEditor.tsx`
- Test: 手测 + 逻辑单测（debounce 工具）

- [ ] **Step 1: 抽 debounce 工具并单测**

```ts
// src/lib/utils/debounce.ts
export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T & { cancel: () => void } { /* clearTimeout + 闭包 */ }
```

测试：连续调用 N 次在 ms 内只触发 1 次；`cancel()` 取消待发。

- [ ] **Step 2: RichTextEditor 接 onChange(debounced)**：props 增 `onChangeDebounced?: (html) => void` + `debounceMs=8000`（≤10s 要求）。内部 `editor.on('update')` → `debounced(onChangeDebounced)`。卸载时 `flush`/`cancel` + 立即保存最后值（防丢失）。

- [ ] **Step 3: 手测**：打字停顿 ~8s 后 dev tools 见 PATCH 请求；切走前保存。

- [ ] **Step 4: Commit**

```bash
git add src/components/RichTextEditor.tsx src/lib/utils/debounce.ts src/__tests__/utils/debounce.test.ts
git commit -m "feat(editor): debounced autosave (<=10s) with flush on unmount"
git push
```

---

### Task 8: ComposeMail 可折叠 CC/BCC + 签名注入 + 收件人校验 + 转发模式

**Files:**
- Modify: `src/components/ComposeMail.tsx`
- Create: `src/components/RecipientFields.tsx`

- [ ] **Step 1: RecipientFields**：To/Cc/Bcc 三栏，Cc/Bcc 默认折叠（点"抄送/密送"展开）；输入实时 `validateRecipients` 标红非法项；外部域用 `findExternalDomains` 给黄色提示条"收件人来自外部域"。

- [ ] **Step 2: ComposeMail**：
  - 初始化时按 `accountId` `getSignatureForAccount` 把签名 HTML 注入编辑器初始内容（仅在空草稿注入，不重复叠加）。
  - `detectAttachmentMention`：body 含"附件"且 attachments 空 → 顶部横幅提醒"你提到了附件但未添加，确认发送？"。
  - 转发模式：`forwardOfMessageId` prop → 加载源邮件 → `buildForward` 预填 subject/body。
  - 发送：组装 `{to,cc,bcc,subject,body,bodyHtml,attachments,forwardOfMessageId}` → POST `/api/send`；成功后若有草稿 id → DELETE 草稿。
  - 自动保存：传 `onChangeDebounced` → PATCH `/api/draft/[id]`（首次无 id 先 POST 创建拿 id）。

- [ ] **Step 3: 手测**：展开 CC/BCC 填地址发送，收方在 CC 看到自己；草稿编辑后刷新内容在；新邮件带签名；转发带 Fwd: 与引用块；提到附件无附件时有提醒。

- [ ] **Step 4: Commit**

```bash
git add src/components/ComposeMail.tsx src/components/RecipientFields.tsx
git commit -m "feat(compose): collapsible cc/bcc + per-account signature + recipient checks + forward mode"
git push
```

---

## 验收标准

- [ ] 发邮件填 CC/BCC：收件方 to/cc/bcc 分发正确；DB messages.to/cc/bcc 各列正确。
- [ ] 草稿：创建 → PATCH 续编不丢字段 → GET/DELETE 正常；编辑器停顿 ≤10s 自动保存、切走前 flush。
- [ ] 新建邮件按 accountId 自动带签名（账号专用优先、回落全局）；不重复叠加。
- [ ] 转发：subject `Fwd:`、引用原文块、`Auto-Submitted: auto-replied` + `References`/`In-Reply-To` 头。
- [ ] 收件人校验：非法地址阻止发送(400)；外部域提醒；提到附件但未添加有提示。
- [ ] `npm test` 全绿。

## 依赖

- 子项目 1（messages to/cc/bcc 列 + 全文 body 不截断；回填机制）。
- 子项目 2（`SendParams`(cc/bcc/inReplyTo/replyToMessageId/attachments)、`ImapAdapter.send`、getAdapter、accounts 表）。
- 子项目 4（attachments 参数透传；撰写附件选择器——本子项目在 ComposeMail 组装 attachments，落盘/上传细节由子项目 4 提供）。

## 风险

- **body 截断**：转发/草稿续编依赖子项目 1 修复 body 全文（spec 子项目 5 风险），否则转发引用 + 草稿内容不全。
- **签名重复叠加**：编辑层每次加载需判断是否已注入，避免多次保存叠加（Task 8 Step 2）。
- **草稿 vs 已发送状态机**：PATCH 只允许 `direction='draft'` 行；发送成功后删除草稿行防重复入库。
- **debounce 延迟窗口**：必须 ≤10s（spec 要求），卸载时 flush 最后值。
- execute 前补全每个任务的 TDD 微步骤。
