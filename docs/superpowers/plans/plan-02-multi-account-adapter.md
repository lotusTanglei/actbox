# 子项目 2 — 多账号抽象 + MailAdapter + 账号管理 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 引入多账号抽象——accounts 表 + MailAdapter 接口 + ImapAdapter（UID-based fetch / 全字段 send）+ 服务商预设 + 账号 CRUD/连接测试 API + 账号管理 UI + 按 accountId 接线收发，并替换 Sidebar 写死的单账号徽标为动态多账号列表。

**Architecture:** 方案 B（详见 spec §0/§1）。凭据**明文**存 accounts（本地约束，无加密）。accounts 表（163/126/qq/gmail/outlook/custom）→ MailAdapter 接口（testConnection/listFolders/fetch/send/move/markRead/delete）→ ImapAdapter 合并重构 receiver+sender → presets → adapterRegistry 按 accountId 取 adapter → 账号 CRUD/test API + UI → fetch/scheduler/send 按 accountId 驱动 + Sidebar 动态渲染。env 中单账号凭据保留作首次引导迁移。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`（用户要求每任务提交推送）。本子项目依赖子项目 1 的迁移框架与 messages 扩列（accountId 等列）。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — accounts 表（Task 6）
- Modify: `src/lib/adapter/types.ts` — MailAdapter 接口 + RawMessage 扩展
- Create: `src/lib/adapter/mail/imapAdapter.ts` — ImapAdapter（合并重构 receiver+sender）
- Create: `src/lib/adapter/mail/presets.ts` — 服务商预设（163/126/qq/gmail/outlook）
- Create: `src/lib/adapter/mail/adapterRegistry.ts` — 按 accountId 取 adapter（含 testConnection）
- Modify: `src/lib/adapter/mail/receiver.ts` / `sender.ts` — 退化为 ImapAdapter 的薄封装或删除（保留导出兼容）
- Modify: `src/lib/scheduler/index.ts` / `src/app/api/fetch/route.ts` / `src/app/api/send/route.ts` — 按 accountId 取配置
- Create: `src/app/api/accounts/route.ts`、`src/app/api/accounts/[id]/route.ts`、`src/app/api/accounts/[id]/test/route.ts`
- Create: `src/app/settings/accounts/page.tsx` — 账号管理 UI
- Modify: `src/components/nav/Sidebar.tsx` — 动态渲染账号列表 + 切换
- Test: `src/__tests__/adapter/imapAdapter.test.ts`、`src/__tests__/adapter/presets.test.ts`、`src/__tests__/api/accounts.test.ts`、`src/__tests__/adapter/registry.test.ts`

---

### Task 6: accounts 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 加 accounts 表到 schema.ts**

```ts
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  provider: text('provider', { enum: ['163', '126', 'qq', 'gmail', 'outlook', 'custom'] }).notNull(),
  protocol: text('protocol', { enum: ['imap', 'pop3'] }).notNull().default('imap'),
  imapHost: text('imap_host'),
  imapPort: integer('imap_port'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  user: text('user').notNull(),
  authCode: text('auth_code').notNull(),        // 明文（本地约束）
  oauthRefreshToken: text('oauth_refresh_token'),
  displayName: text('display_name'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  syncMode: text('sync_mode', { enum: ['idle', 'poll'] }).notNull().default('idle'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  syncStatus: text('sync_status', { enum: ['healthy', 'syncing', 'error', 'disabled'] }).notNull().default('healthy'),
  syncError: text('sync_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => ({ activeIdx: index('idx_accounts_active').on(t.isActive) }))
```

- [ ] **Step 2: 生成迁移** `npm run db:generate`（产出 accounts 建表 SQL）。

- [ ] **Step 3: 运行迁移测试** `npx vitest run src/__tests__/db/migration.test.ts` → PASS（accounts 表存在）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): accounts table (plaintext auth_code, local-only)"
git push
```

---

### Task 7: MailAdapter 接口 + RawMessage 扩展

**Files:**
- Modify: `src/lib/adapter/types.ts`

- [ ] **Step 1: 写接口**

```ts
// src/lib/adapter/types.ts
export interface FolderInfo { path: string; displayName: string; type: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'; unreadCount?: number; totalCount?: number }

export interface SendParams {
  to: string; cc?: string; bcc?: string
  subject: string; body: string         // 纯文本
  bodyHtml?: string
  attachments?: { filename: string; path?: string; content?: string; cid?: string }[]
  replyToMessageId?: string
  inReplyTo?: string
}

export interface AccountConfig {
  id: number; email: string; user: string; authCode: string
  imapHost: string; imapPort: number; smtpHost: string; smtpPort: number
  displayName?: string
}

export interface MailAdapter {
  testConnection(): Promise<{ ok: boolean; detail: string }>
  listFolders(): Promise<FolderInfo[]>
  fetch(opts: { folder: string; since?: Date; uidRange?: [number, number] }): Promise<RawMessage[]>
  send(params: SendParams): Promise<{ messageId: string; imapUid?: number }>
  move(uid: number, fromFolder: string, toFolder: string): Promise<void>
  markRead(uid: number, folder: string, isRead: boolean): Promise<void>
  delete(uid: number, folder: string): Promise<void>
}

export interface RawMessage {
  messageId: string
  subject: string | null
  from: string | null
  to?: string | null
  cc?: string | null
  bcc?: string | null
  body: string
  bodyHtml: string | null
  receivedAt: Date | null
  accountId?: number
  folder?: string
  imapUid?: number
  imapSeq?: number
}
```

- [ ] **Step 2: tsc 检查** `npx tsc --noEmit` → 无错。

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapter/types.ts
git commit -m "feat(adapter): MailAdapter interface + RawMessage multi-account fields"
git push
```

---

### Task 8: ImapAdapter（重构 receiver + sender）

**Files:**
- Create: `src/lib/adapter/mail/imapAdapter.ts`
- Test: `src/__tests__/adapter/imapAdapter.test.ts`

- [ ] **Step 1: 写失败测试（契约：fetch 用 folder+UID，send 透传 cc/bcc/attachments）**——mock ImapFlow/nodemailer，断言 `fetch({folder:'INBOX', uidRange:[a,b]})` 调 `client.search` 用 UID 范围、`send` 调 `transporter.sendMail` 带 html+cc+bcc。

```ts
import { describe, it, expect, vi } from 'vitest'
import { ImapAdapter } from '@/lib/adapter/mail/imapAdapter'

describe('ImapAdapter 契约', () => {
  it('fetch 用 folder + UID 范围（不用 sequence）', async () => {
    const search = vi.fn().mockReturnValue([10, 11, 12])
    const fetchOne = vi.fn()
    const client = { connect: vi.fn(), mailboxOpen: vi.fn(), search, fetch: fetchOne, logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.fetch({ folder: 'INBOX', uidRange: [10, 12] })
    expect(search).toHaveBeenCalledWith({ uid: { gte: 10, lte: 12 } }) // 关键：UID 而非 seen/seq
  })

  it('send 透传 html/cc/bcc/attachments', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<id>' })
    const a = new ImapAdapter(cfg(), { transporterFactory: () => ({ sendMail }) as any })
    await a.send({ to: 'b@x', cc: 'c@x', bcc: 'd@x', subject: 's', body: 't', bodyHtml: '<p>h</p>', attachments: [{ filename: 'f', path: '/p' }] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ cc: 'c@x', bcc: 'd@x', html: '<p>h</p>', attachments: expect.any(Array) }))
  })

  it('testConnection 返回 ok/detail', async () => {
    const client = { connect: vi.fn().mockResolvedValue(undefined), logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    const r = await a.testConnection()
    expect(r.ok).toBe(true)
  })
})
function cfg() { return { id:1, email:'a@b', user:'a@b', authCode:'x', imapHost:'h', imapPort:993, smtpHost:'h', smtpPort:465 } }
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/adapter/imapAdapter.test.ts` → FAIL。

- [ ] **Step 3: 实现 ImapAdapter**（用 ImapFlow + nodemailer；构造函数接受 `clientFactory`/`transporterFactory` 注入便于测试；fetch 用 `search({ uid: { gte, lte } })` + `fetch` 拉取；send 组装 nodemailer 选项含 html/cc/bcc/attachments + In-Reply-To 头；testConnection 尝试 connect）。把现有 `receiver.ts`/`sender.ts` 的逻辑搬入。

- [ ] **Step 4: 运行确认通过**：`npx vitest run src/__tests__/adapter/imapAdapter.test.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapter/mail/imapAdapter.ts src/__tests__/adapter/imapAdapter.test.ts
git commit -m "feat(adapter): ImapAdapter with UID-based fetch + full send params"
git push
```

---

### Task 9: 服务商 presets

**Files:**
- Create: `src/lib/adapter/mail/presets.ts`
- Test: `src/__tests__/adapter/presets.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { getPreset, PRESETS } from '@/lib/adapter/mail/presets'

describe('provider presets', () => {
  it('163 预设正确', () => {
    expect(getPreset('163')).toEqual(expect.objectContaining({ imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 }))
  })
  it('gmail/oauth 标记', () => {
    expect(getPreset('gmail')?.oauth).toBe(true)
  })
  it('custom 无预设返回 null', () => {
    expect(getPreset('custom')).toBeNull()
  })
  it('PRESETS 覆盖主流服务商', () => {
    expect(PRESETS.map(p => p.provider)).toEqual(expect.arrayContaining(['163', '126', 'qq', 'gmail', 'outlook']))
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 presets**（163/126/qq/gmail/outlook 的 host/port/secure/oauth 标记）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapter/mail/presets.ts src/__tests__/adapter/presets.test.ts
git commit -m "feat(adapter): provider presets (163/126/qq/gmail/outlook)"
git push
```

---

### Task 10: 账号 CRUD + 连接测试 API

**Files:**
- Create: `src/app/api/accounts/route.ts`、`src/app/api/accounts/[id]/route.ts`、`src/app/api/accounts/[id]/test/route.ts`
- Create: `src/lib/adapter/mail/adapterRegistry.ts`（按 accountId 从库取配置 → 构造 ImapAdapter）
- Test: `src/__tests__/api/accounts.test.ts`

- [ ] **Step 1: 写失败测试**（POST 创建账号 → 库有行；GET 列出；PATCH 启停；`test` 用注入的假 adapter 返回 ok）。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现** 三个路由 + `adapterRegistry.getAdapter(accountId)` + `testConnection`。创建账号时若 provider 有 preset 自动填 host/port。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/accounts src/lib/adapter/mail/adapterRegistry.ts src/__tests__/api/accounts.test.ts
git commit -m "feat(accounts): CRUD + connection-test API"
git push
```

---

### Task 11: 账号管理 UI

**Files:**
- Create: `src/app/settings/accounts/page.tsx`

- [ ] **Step 1: 实现 UI**（账号列表 + 新增表单：选 provider preset 自动填 host/port、输入 email/user/授权码、"测试连接"按钮调 `/api/accounts/[id]/test` 显示 ok/错误、启用停用开关、删除、每账号显示 lastSyncedAt/syncStatus）。

- [ ] **Step 2: 手测**：加一个 163 账号、测试连接成功、出现在列表。

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/accounts
git commit -m "feat(accounts): account management UI (add/test/toggle/delete)"
git push
```

---

### Task 12: 按 accountId 接线 + Sidebar 动态账号

**Files:**
- Modify: `src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts`、`src/app/api/send/route.ts`、`src/components/nav/Sidebar.tsx`

- [ ] **Step 1: 改 fetch/scheduler/send**：从库读 `accounts where is_active`，对每账号 `getAdapter(id).fetch(...)`；写入 messages 时填 `accountId/folder/imapUid`。移除 `process.env.IMAP_USER/IMAP_AUTH_CODE` 单例依赖（保留作首次引导迁移：若库无账号但 env 有，自动建一个默认账号）。

- [ ] **Step 2: 改 Sidebar**：动态从 `/api/accounts` 渲染账号列表（替换写死的 "163" 徽标），支持点击切换/聚合；未读角标按账号或聚合。

- [ ] **Step 3: 写测试 `src/__tests__/adapter/registry.test.ts`**（多账号各自取 adapter、env 引导迁移建默认账号）→ 运行通过。

- [ ] **Step 4: 手测**：两个账号都能拉取、各自入库带 accountId；切换账号看对应邮件。

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/index.ts src/app/api/fetch/route.ts src/app/api/send/route.ts src/components/nav/Sidebar.tsx src/__tests__/adapter/registry.test.ts
git commit -m "feat(accounts): wire fetch/send by accountId + dynamic sidebar"
git push
```
