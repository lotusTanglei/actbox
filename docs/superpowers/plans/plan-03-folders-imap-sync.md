# 子项目 3 — 标准文件夹体系 + IMAP 双向同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 从"只连 INBOX 的客户端虚拟过滤"升级为真实邮箱文件夹：`listFolders()` 同步服务器文件夹到本地 `folders` 表；收件箱/已发送/草稿/垃圾/已删除/归档完整视图 + 未读角标；归档 / 垃圾箱还原 / 彻底删除 / 保留期清除；本地移动/标记/标星经 UID 增量回写服务器（冲突按 UID+modseq、断点续传 + 幂等）。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 3）。本地单机、凭据明文。folders 表存服务器文件夹映射；6 类系统文件夹 + 自定义文件夹；本地动作（归档/移动/标星/标记已读/还原/删除）经 `MailAdapter` 的 `move/markRead/delete` 用 UID 增量回写 IMAP；冲突用 `UIDVALIDITY + modseq`，UIDVALIDITY 变化重新映射而非重复入库；断网操作进幂等重放队列，断点续传不丢不重。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / TipTap 3 / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 1（messages `folder/imap_uid/imap_seq/is_archived/archived_at` 列 + 迁移框架）与子项目 2（`MailAdapter` 接口含 `listFolders/move/markRead/delete`、`FolderInfo`、`accounts` 表）。阶段 1 执行——执行前补全 TDD 微步骤（每任务先写失败测试再实现）。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — `folders` 表（Task 1）
- Create: `src/lib/folders/repo.ts` — folders 表读写（upsert/list by account/by type、角标刷新）
- Create: `src/lib/folders/classify.ts` — 服务器 path → 系统 type 识别（INBOX/Sent/Drafts/Trash/Spam/Junk/Archive 特殊名 + XLIST/`\SpecialUse`）
- Create: `src/lib/folders/sync.ts` — `listFolders()` → folders 表 upsert + 角标汇总
- Create: `src/lib/sync/writeback.ts` — 本地动作 → `MailAdapter.move/markRead/delete` + 乐观更新 + 失败回滚 + 幂等记录
- Create: `src/lib/sync/uidvalidity.ts` — UIDVALIDITY 变化检测与重新映射
- Modify: `src/lib/adapter/mail/imapAdapter.ts` — `listFolders` 实体实现（含 `\SpecialUse`/`specialUse`）、`fetch` 带 `highestModSeq`（CONDSTORE）、`move`/`delete` 落地
- Modify: `src/lib/adapter/types.ts` — `MailAdapter.fetch` opts 增 `highestModSeq?`；`FolderInfo` 复用 plan-02 定义（不改动签名）
- Create: `src/app/api/folders/route.ts` — GET 列出文件夹（按 account/聚合）+ POST 触发同步
- Create: `src/app/api/folders/[id]/route.ts` — PATCH（创建自定义文件夹）/ DELETE
- Modify: `src/app/api/messages/[id]/route.ts` — PATCH 增 `move/archive/restore/markRead/star/delete` 动作
- Create: `src/app/api/messages/[id]/route.ts`（若 messages/[id] 仅 GET，则改为支持 PATCH 动作）
- Modify: `src/components/nav/Sidebar.tsx` — 系统文件夹视图 + 未读角标
- Create: `src/lib/sync/retention.ts` — 垃圾箱/已删除保留期到期清除
- Test: `src/__tests__/folders/classify.test.ts`、`src/__tests__/folders/sync.test.ts`、`src/__tests__/sync/writeback.test.ts`、`src/__tests__/sync/uidvalidity.test.ts`、`src/__tests__/api/folders.test.ts`、`src/__tests__/api/message-actions.test.ts`

---

## 任务

### Task 1: folders 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 加 folders 表**

```ts
export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  path: text('path').notNull(),                 // IMAP 服务器路径，如 'INBOX' / '[Gmail]/Sent Mail'
  displayName: text('display_name').notNull(),
  type: text('type', { enum: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive', 'custom'] }).notNull().default('custom'),
  unreadCount: integer('unread_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
}, (t) => ({
  accPathUq: uniqueIndex('uq_folders_account_path').on(t.accountId, t.path),
}))
```

- [ ] **Step 2: 生成迁移** `npm run db:generate`（产出 folders 建表 SQL，含唯一索引）。

- [ ] **Step 3: 运行迁移测试确认 folders 表存在** `npx vitest run src/__tests__/db/migration.test.ts` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): folders table for server folder sync"
git push
```

---

### Task 2: 文件夹类型识别 classify

**Files:**
- Create: `src/lib/folders/classify.ts`
- Test: `src/__tests__/folders/classify.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { classifyFolder, type SpecUse } from '@/lib/folders/classify'

describe('classifyFolder 服务器 path → 系统 type', () => {
  it('INBOX → inbox', () => {
    expect(classifyFolder('INBOX', null)).toBe('inbox')
  })
  it('\\Sent / specialUse=sent → sent', () => {
    expect(classifyFolder('Sent', { '\\Sent' } as SpecUse)).toBe('sent')
  })
  it('\\Trash 与特殊名 Trash/已删除 → trash', () => {
    expect(classifyFolder('Trash', { '\\Trash' } as SpecUse)).toBe('trash')
    expect(classifyFolder('已删除', null)).toBe('trash')
  })
  it('\\Junk / Spam / 垃圾邮件 → spam', () => {
    expect(classifyFolder('Junk', { '\\Junk' } as SpecUse)).toBe('spam')
    expect(classifyFolder('垃圾邮件', null)).toBe('spam')
  })
  it('\\Drafts / Draft / 草稿 → drafts', () => {
    expect(classifyFolder('Drafts', { '\\Drafts' } as SpecUse)).toBe('drafts')
  })
  it('\\Archive / All Mail / 归档 → archive', () => {
    expect(classifyFolder('[Gmail]/All Mail', { '\\All' } as SpecUse)).toBe('archive')
  })
  it('未知 → custom', () => {
    expect(classifyFolder('Project X', null)).toBe('custom')
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run src/__tests__/folders/classify.test.ts` → FAIL。

- [ ] **Step 3: 实现 classifyFolder**：签名 `classifyFolder(path: string, specialUse: Set<string> | null): FolderType`。优先 `specialUse`（`\Inbox/\Sent/\Trash/\Junk/\Drafts/\Archive/\All`），其次 path 名字表（含中英：INBOX/Sent/Trash/Spam/Junk/Drafts/Archive/"已发送"/"已删除"/"草稿"/"垃圾邮件"/"归档"），均不匹配返回 `'custom'`。`type SpecUse = Set<string> | null`。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/folders/classify.ts src/__tests__/folders/classify.test.ts
git commit -m "feat(folders): classify server folder path/specialUse to system type"
git push
```

---

### Task 3: folders repo + listFolders 同步

**Files:**
- Create: `src/lib/folders/repo.ts`
- Create: `src/lib/folders/sync.ts`
- Modify: `src/lib/adapter/types.ts`（`fetch` opts 增 `highestModSeq?`）
- Test: `src/__tests__/folders/sync.test.ts`

- [ ] **Step 1: 改 types.ts，fetch opts 增 highestModSeq**

```ts
fetch(opts: { folder: string; since?: Date; uidRange?: [number, number]; highestModSeq?: bigint }): Promise<RawMessage[]>
```

- [ ] **Step 2: 写失败测试（用注入假 adapter，断言 upsert + 角标汇总）**

```ts
import { describe, it, expect, vi } from 'vitest'
import { syncFolders } from '@/lib/folders/sync'

describe('syncFolders', () => {
  it('listFolders 结果 upsert 进 folders 表，角标正确', async () => {
    const adapter = { listFolders: vi.fn().mockResolvedValue([
      { path: 'INBOX', displayName: 'INBOX', type: 'inbox', unreadCount: 3, totalCount: 10 },
      { path: 'Sent', displayName: 'Sent', type: 'sent', unreadCount: 0, totalCount: 5 },
    ]) } as any
    const db = memDb()
    await syncFolders(db, { accountId: 1, adapter })
    const rows = db.prepare('SELECT path,type,unread_count,total_count FROM folders WHERE account_id=1 ORDER BY path').all()
    expect(rows).toEqual([
      { path: 'INBOX', type: 'inbox', unread_count: 3, total_count: 10 },
      { path: 'Sent', type: 'sent', unread_count: 0, total_count: 5 },
    ])
  })

  it('服务器删除的文件夹 保留行不报错（幂等 upsert）', async () => {
    const adapter = { listFolders: vi.fn().mockResolvedValue([{ path: 'INBOX', displayName: 'INBOX', type: 'inbox' }]) } as any
    const db = memDb()
    await syncFolders(db, { accountId: 1, adapter })
    await syncFolders(db, { accountId: 1, adapter }) // 二次同步幂等
    expect(db.prepare('SELECT count(*) c FROM folders WHERE account_id=1').get()).toMatchObject({ c: 1 })
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 repo.ts**

`upsertFolder(db, { accountId, path, displayName, type, unreadCount, totalCount })`：`INSERT ... ON CONFLICT(account_id, path) DO UPDATE`。`listFolders(db, accountId)`、`listByType(db, accountId | 'all', type)`。

- [ ] **Step 5: 实现 sync.ts**

`syncFolders(db, { accountId, adapter })`：调 `adapter.listFolders()` → 对每 `FolderInfo` 调 `classifyFolder`（若 adapter 已给 type 则信任，否则用 classify）→ `upsertFolder`。返回同步数量。

- [ ] **Step 6: 运行确认通过** → PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/adapter/types.ts src/lib/folders/repo.ts src/lib/folders/sync.ts src/__tests__/folders/sync.test.ts
git commit -m "feat(folders): listFolders sync into folders table + badges"
git push
```

---

### Task 4: ImapAdapter.listFolders / move / delete 落地 + CONDSTORE modseq

**Files:**
- Modify: `src/lib/adapter/mail/imapAdapter.ts`
- Test: `src/__tests__/adapter/imapAdapter.folders.test.ts`

- [ ] **Step 1: 写失败测试（契约）**

```ts
import { describe, it, expect, vi } from 'vitest'
import { ImapAdapter } from '@/lib/adapter/mail/imapAdapter'

describe('ImapAdapter 文件夹/动作契约', () => {
  it('listFolders 读 specialUse 并映射 type', async () => {
    const list = vi.fn().mockResolvedValue([
      { path: 'INBOX', specialUse: '\\Inbox', name: 'INBOX' },
      { path: 'Sent', specialUse: '\\Sent', name: 'Sent' },
      { path: 'X', specialUse: null, name: 'X' },
    ])
    const client = { connect: vi.fn(), list, logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    const folders = await a.listFolders()
    expect(folders.map(f => [f.path, f.type])).toEqual([
      ['INBOX', 'inbox'], ['Sent', 'sent'], ['X', 'custom'],
    ])
  })

  it('move 用 UID STORE + COPY/EXPUNGE', async () => {
    const client = { connect: vi.fn(), mailboxOpen: vi.fn(), messageMove: vi.fn().mockResolvedValue(undefined), logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.move(99, 'INBOX', 'Archive')
    expect(client.messageMove).toHaveBeenCalledWith(expect.objectContaining({ uid: true, range: '99', source: 'INBOX', destination: 'Archive' }))
  })

  it('delete 用 UID + \\Deleted + expunge', async () => {
    const del = vi.fn()
    const expunge = vi.fn()
    const client = { connect: vi.fn(), mailboxOpen: vi.fn(), messageFlagsAdd: del, messageFlagsAddExpunge: expunge, logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.delete(99, 'Trash')
    expect(del).toHaveBeenCalledWith(expect.objectContaining({ uid: true, range: '99', add: ['\\Deleted'] }))
  })
})
function cfg() { return { id:1, email:'a@b', user:'a@b', authCode:'x', imapHost:'h', imapPort:993, smtpHost:'h', smtpPort:465 } }
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**：`listFolders()` 用 ImapFlow `client.list()`（返回 `{path, specialUse, name}`），映射 type（`classifyFolder` 或内联），unread/total 可选（`status` 命令，失败则留空）。`move(uid, from, to)` 用 `client.messageMove({ uid:true, range:String(uid), source:from, destination:to })`。`delete(uid, folder)` 用 `messageFlagsAdd({uid:true, range:String(uid), add:['\\Deleted']})` + EXPUNGE（Trash 用直接删除语义）。`fetch({folder, highestModSeq})` 用 `search({ modseq: highestModSeq })`（ImapFlow 支持 CONDSTORE；服务器不支持时 `highestModSeq` 忽略降级）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapter/mail/imapAdapter.ts src/__tests__/adapter/imapAdapter.folders.test.ts
git commit -m "feat(adapter): listFolders/move/delete + CONDSTORE modseq fetch"
git push
```

---

### Task 5: UIDVALIDITY 变化检测与重新映射

**Files:**
- Create: `src/lib/sync/uidvalidity.ts`
- Test: `src/__tests__/sync/uidvalidity.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { checkUidValidity } from '@/lib/sync/uidvalidity'

describe('UIDVALIDITY 处理', () => {
  it('首次记录返回 ok=false(无旧值), 不清', () => {
    const db = memDb()
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    expect(r.known).toBe(false)
    expect(r.mustRemap).toBe(false)
  })
  it('相同 uidValidity 不重映射', () => {
    const db = memDb(); checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    expect(r.mustRemap).toBe(false)
  })
  it('uidValidity 变化 → mustRemap=true, 返回受影响旧 uid 列表', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, direction) VALUES ('<m1>',1,'INBOX',10,'in'),('<m2>',1,'INBOX',11,'in')`)
    checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 123 })
    const r = checkUidValidity(db, { accountId: 1, folder: 'INBOX', uidValidity: 999 })
    expect(r.mustRemap).toBe(true)
    expect(r.staleUids.sort()).toEqual([10, 11])
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 checkUidValidity**：用 settings 表 KV 存 `uidvalidity:{accountId}:{folder}`（或专用 `folder_meta` KV）。首次：写值返回 `{known:false, mustRemap:false}`。相同：`{known:true, mustRemap:false}`。变化：标 messages 的 `imap_uid=NULL`（清持久标识，防重复入库）+ 返回 `{known:true, mustRemap:true, staleUids:[...]}` 供上层重拉重映射。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/uidvalidity.ts src/__tests__/sync/uidvalidity.test.ts
git commit -m "feat(sync): UIDVALIDITY change detection + remap"
git push
```

---

### Task 6: 本地动作回写 writeback（移动/标记/标星/归档/还原/删除）+ 幂等 + 冲突

**Files:**
- Create: `src/lib/sync/writeback.ts`
- Test: `src/__tests__/sync/writeback.test.ts`

**关键设计：** 本地动作先乐观更新 messages（如 `folder`/`is_read`/`is_starred`/`is_archived`），再调 adapter 回写服务器；回写失败则回滚乐观更新并记 `jobs(status=failed)` 待重试。幂等键 `account_id+folder+imap_uid+action`，重复动作不重复回写。冲突按 `UID + modseq`：回写前 fetch 该 UID 的最新 FLAGS，若与本地乐观值冲突（如服务器已读但本地标未读）按 last-write-wins 但记日志。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { applyAction } from '@/lib/sync/writeback'

describe('applyAction 回写', () => {
  it('markRead 乐观更新 + 调 adapter.markRead + 幂等', async () => {
    const adapter = { markRead: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, is_read, direction) VALUES ('<m1>',1,'INBOX',10,0,'in')`)
    await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true })
    expect(adapter.markRead).toHaveBeenCalledWith(10, 'INBOX', true)
    expect((db.prepare('SELECT is_read FROM messages WHERE id=1').get() as any).is_read).toBe(1)
    adapter.markRead.mockClear()
    await applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true }) // 幂等
    expect(adapter.markRead).not.toHaveBeenCalled()
  })

  it('move 乐观更新 folder + 调 adapter.move', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, direction) VALUES ('<m1>',1,'INBOX',10,'in')`)
    await applyAction(db, { adapter, action: 'move', messageIds: [1], targetFolder: 'Archive' })
    expect(adapter.move).toHaveBeenCalledWith(10, 'INBOX', 'Archive')
    expect((db.prepare('SELECT folder FROM messages WHERE id=1').get() as any).folder).toBe('Archive')
  })

  it('archive 设 is_archived + archived_at', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, direction) VALUES ('<m1>',1,'INBOX',10,'in')`)
    await applyAction(db, { adapter, action: 'archive', messageIds: [1] })
    const row = db.prepare('SELECT is_archived, archived_at FROM messages WHERE id=1').get() as any
    expect(row.is_archived).toBe(1)
    expect(row.archived_at).not.toBeNull()
  })

  it('restore 取消 is_archived/is_deleted + move 回 INBOX', async () => {
    const adapter = { move: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, is_deleted, is_archived, direction) VALUES ('<m1>',1,'Trash',10,1,0,'in')`)
    await applyAction(db, { adapter, action: 'restore', messageIds: [1] })
    expect(adapter.move).toHaveBeenCalledWith(10, 'Trash', 'INBOX')
    const row = db.prepare('SELECT is_deleted, folder FROM messages WHERE id=1').get() as any
    expect(row.is_deleted).toBe(0)
    expect(row.folder).toBe('INBOX')
  })

  it('adapter 失败 → 回滚乐观更新', async () => {
    const adapter = { markRead: vi.fn().mockRejectedValue(new Error('net')) } as any
    const db = memDb()
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, is_read, direction) VALUES ('<m1>',1,'INBOX',10,0,'in')`)
    await expect(applyAction(db, { adapter, action: 'markRead', messageIds: [1], value: true })).rejects.toThrow('net')
    expect((db.prepare('SELECT is_read FROM messages WHERE id=1').get() as any).is_read).toBe(0) // 回滚
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 applyAction**

签名：`applyAction(db, { adapter, action, messageIds, value?, targetFolder? }): Promise<void>`。`action` 枚举：`'markRead' | 'star' | 'move' | 'archive' | 'restore' | 'delete'`。流程：事务内读出 messages 的 `(id, accountId, folder, imapUid, isRead)` → 算出目标 adapter 调用 + 新字段值 → 先写本地（乐观）→ 提交事务 → 逐条调 adapter（同 uid+action 幂等：已与目标值一致则跳过回写）→ 任一 adapter 失败则回滚本次乐观更新（恢复旧字段）并 throw（上层落 jobs 重试）。`delete` = `is_deleted=1` + `adapter.delete`；`restore` = `is_deleted=0, is_archived=0` + `adapter.move → INBOX`；`archive` = `is_archived=1, archived_at=now` + `adapter.move → Archive`（Archive path 从 folders 表 type=archive 取，缺则用本地虚拟归档不回写服务器）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/writeback.ts src/__tests__/sync/writeback.test.ts
git commit -m "feat(sync): optimistic local actions + UID writeback + idempotent retry"
git push
```

---

### Task 7: folders API + message 动作 API

**Files:**
- Create: `src/app/api/folders/route.ts`、`src/app/api/folders/[id]/route.ts`
- Modify: `src/app/api/messages/[id]/route.ts`（PATCH 增动作）
- Test: `src/__tests__/api/folders.test.ts`、`src/__tests__/api/message-actions.test.ts`

- [ ] **Step 1: 写失败测试**

folders.test.ts：`GET /api/folders?accountId=1` 返回 folders 行；`POST /api/folders/sync`（body `{accountId}`）触发 syncFolders 返回数量。

message-actions.test.ts：`PATCH /api/messages/5`（body `{action:'archive'}`）→ 调 writeback（注入假）→ 200；`{action:'move', targetFolder:'X'}` → 200；`{action:'restore'}` → 200；`{action:'delete'}` → 200；非法 action → 400。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `GET /api/folders`：按 `accountId` 或聚合返回 folders 列表（含角标）。
  - `POST /api/folders/sync`：`{accountId}` → `getAdapter(accountId)` → `syncFolders` → 返回数量。
  - `PATCH /api/folders/[id]`：创建/改名自定义文件夹（`adapter.createFolder`/`renameFolder` 若 adapter 支持，否则仅本地）。
  - `PATCH /api/messages/[id]`：body `{action, value?, targetFolder?}` → `applyAction(db, { adapter: getAdapter(accountId), action, messageIds:[id], ... })` → 200/400/500。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/folders src/app/api/messages/[id]/route.ts src/__tests__/api/folders.test.ts src/__tests__/api/message-actions.test.ts
git commit -m "feat(api): folders sync + message move/archive/restore/delete actions"
git push
```

---

### Task 8: 垃圾箱/已删除保留期清除

**Files:**
- Create: `src/lib/sync/retention.ts`
- Test: `src/__tests__/sync/retention.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { purgeExpiredDeleted } from '@/lib/sync/retention'

describe('保留期清除', () => {
  it('is_deleted 超 N 天 的邮件彻底删除（物理 + adapter.expunge）', async () => {
    const adapter = { delete: vi.fn().mockResolvedValue(undefined) } as any
    const db = memDb()
    const old = Math.floor(Date.now()/1000) - 31*86400
    db.exec(`INSERT INTO messages (message_id, account_id, folder, imap_uid, is_deleted, archived_at, direction)
             VALUES ('<m1>',1,'Trash',10,1,${old},'in'),('<m2>',1,'Trash',11,1,${Math.floor(Date.now()/1000)},'in')`)
    const stats = await purgeExpiredDeleted(db, { adapter, retentionDays: 30 })
    expect(stats.purged).toBe(1)
    expect(adapter.delete).toHaveBeenCalledTimes(1)
    expect(db.prepare('SELECT count(*) c FROM messages WHERE id=1').get()).toMatchObject({ c: 0 })
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 purgeExpiredDeleted**：查 `is_deleted=1 AND archived_at < now - retentionDays`（archived_at 兼用作删除时间戳；若为空用 processed_at）→ 对每条调 `adapter.delete(uid, folder)` → 成功后物理 `DELETE FROM messages WHERE id`（级联由子项目 4 的附件引用计数/子项目 1 的 todo 关联处理，此处只删 message 行）。retentionDays 默认 30，可配。失败行不删本地、记日志，下次重试。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/retention.ts src/__tests__/sync/retention.test.ts
git commit -m "feat(sync): trash retention purge (30d default)"
git push
```

---

### Task 9: Sidebar 系统文件夹视图 + 未读角标

**Files:**
- Modify: `src/components/nav/Sidebar.tsx`

- [ ] **Step 1: 改 Sidebar**：从 `/api/folders` 渲染 6 类系统文件夹（收件箱/已发送/草稿/垃圾/已删除/归档）+ 自定义文件夹，每项显示 `unreadCount` 角标；点击切换 `folder` 过滤；归档/已删除为本地视图（`is_archived` / `is_deleted` 过滤），其余按 messages.folder。聚合模式（多账号）合并同名文件夹角标。

- [ ] **Step 2: 手测**：同步出 INBOX/Sent/Trash 角标正确；点归档看归档邮件；点已删除看垃圾桶邮件。

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/Sidebar.tsx
git commit -m "feat(ui): system folder views with unread badges in Sidebar"
git push
```

---

## 验收标准

- [ ] 6 类系统文件夹（收件箱/已发送/草稿/垃圾/已删除/归档）可见且未读角标正确（与服务器一致）。
- [ ] `listFolders()` 同步后 folders 表行数与服务器文件夹一致；二次同步幂等。
- [ ] 归档邮件移出收件箱、可恢复（还原）；垃圾箱可还原 + 彻底删除；保留期到期自动清除。
- [ ] 本地移动/标记/标星经 UID 回写服务器；网络抖动（adapter 失败）乐观更新回滚不丢不重、入 jobs 重试。
- [ ] UIDVALIDITY 变化时重新映射、不重复入库。
- [ ] `npm test` 全绿（folders classify/sync、writeback、uidvalidity、retention、folders/actions API）。

## 依赖

- 子项目 1（messages `folder/imap_uid/imap_seq/is_archived/archived_at` 列 + drizzle 迁移）。
- 子项目 2（`MailAdapter`/`FolderInfo`/`getAdapter(accountId)`/accounts 表）。

## 风险

- **必须用 UID（非 MSN）做持久标识**——expunge 后 sequence 重排会导致错乱（spec §2.3）。`move/delete`/`fetch` 全程 UID。
- **UIDVALIDITY 变化重新映射**而非重复入库（spec 子项目 3 风险）。
- **冲突**：本地乐观 vs 服务器并发——last-write-wins + modseq 比对 + 日志。
- **归档/已删除的本地虚拟语义**与服务器真实文件夹映射（部分服务商无 Archive 文件夹，本地归档不回写）。
- execute 前补全每个任务的 TDD 微步骤（先红后绿）。
