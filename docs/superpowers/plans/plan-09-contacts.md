# 子项目 9 — 联系人通讯录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 webmail 加上完整通讯录——联系人/分组 CRUD、ComposeMail 收件人自动补全（通讯录 ∪ 历史通信记录、高频置顶）、邮件详情页"加入通讯录"、分组群发、CSV/vCard 导入导出、联系人↔邮件双向跳转、发信/收信自动更新常用度——把"散落在邮件头里的邮箱地址"沉淀为可管理、可联想、可双向跳转的联系人库。

**Architecture:** 方案 B（详见 spec §0/§1/子项目 9）。本地单机、单进程、单 SQLite(WAL)。`contacts` 表按 `account_id` 隔离，含 `name/email/phone/note/avatar_path/group_id/contact_count/last_contacted_at`；`contacts_groups` 表承载分组/邮件组（`account_id` + `name`）。自动补全是本子项目核心：`/api/contacts/autocomplete?q=` 查询 = 通讯录匹配（name/email 前缀/子串） ∪ 历史通信记录（messages 的 `from`/`to`/`cc`/`bcc` 解析出的地址，按出现频次聚合），合并后**先按"是否在通讯录"置顶、再按 contact_count/历史频次降序**取前 N。常用度在**入库（收信）**与**发送（出信）**两条路径经 `bumpContact` 自动 upsert + `contact_count+1` + 刷新 `last_contacted_at`（UTC）。导入导出走 vCard 3.0（单文件多 `BEGIN:VCARD`）与 CSV（`name,email,phone,note`），解析真实代码内联、不引重型依赖库。联系人↔邮件双向跳转：联系人详情按 email 匹配 `messages.from/messages.to` 拉往来邮件；邮件详情点发件人/收件人 email 查名片。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 2（`accounts` 表 + `messages.account_id` + adapterRegistry 取 accountId）与子项目 5（`messages.to/cc/bcc` 拆分 + ComposeMail 收件人输入流）。阶段 3 执行——执行前补全 TDD 微步骤（每任务先写失败测试再实现）。

---

## 文件结构

- Modify: `src/lib/db/schema.ts` — `contacts` / `contacts_groups` 表（Task 1）
- Create: `src/lib/contacts/repo.ts` — contacts/contacts_groups CRUD + upsertByEmail + bumpContact（Task 2）
- Create: `src/lib/contacts/parse-emails.ts` — 从 messages 的 from/to/cc/bcc 解析出 `{name,email}[]`（Task 2）
- Create: `src/lib/contacts/autocomplete.ts` — 自动补全聚合查询（通讯录 ∪ 历史，频次排序）（Task 3）
- Create: `src/lib/contacts/import-export.ts` — vCard 3.0 / CSV 解析与序列化（Task 7）
- Modify: `src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts` — 收信入库后 `bumpContact`（Task 4）
- Modify: `src/app/api/send/route.ts` — 发送成功后 `bumpContact`（to/cc/bcc）（Task 4）
- Create: `src/app/api/contacts/route.ts` — GET 列表/POST 创建（Task 5）
- Create: `src/app/api/contacts/[id]/route.ts` — GET 单/PATCH/DELETE（Task 5）
- Create: `src/app/api/contacts/autocomplete/route.ts` — GET 自动补全（Task 3）
- Create: `src/app/api/contacts/groups/route.ts`、`src/app/api/contacts/groups/[id]/route.ts` — 分组 CRUD + 群发展开（Task 6）
- Create: `src/app/api/contacts/import/route.ts`、`src/app/api/contacts/export/route.ts` — 导入导出（Task 7）
- Create: `src/app/contacts/page.tsx` — 通讯录独立页（名片网格/列表 + 搜索 + 分组侧栏 + 增删改抽屉 + 导入导出按钮）（Task 8）
- Create: `src/app/contacts/[id]/page.tsx` — 联系人详情（名片 + 往来邮件列表 + 编辑）（Task 8）
- Modify: `src/components/ComposeMail.tsx` — 收件人输入框接自动补全下拉（Task 9）
- Modify: `src/app/mails/[id]/page.tsx` — 发件人/收件人旁"加入通讯录"/"查看名片"按钮（Task 10）
- Modify: `src/components/nav/Sidebar.tsx`、`src/app/settings/` — 通讯录入口（Task 8）
- Test: `src/__tests__/contacts/repo.test.ts`、`src/__tests__/contacts/parse-emails.test.ts`、`src/__tests__/contacts/autocomplete.test.ts`、`src/__tests__/contacts/import-export.test.ts`、`src/__tests__/api/contacts.test.ts`、`src/__tests__/api/contacts-groups.test.ts`、`src/__tests__/api/contacts-autocomplete.test.ts`、`src/__tests__/api/contacts-import-export.test.ts`

---

## 任务

### Task 1: contacts / contacts_groups 表 + 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 加 contacts 与 contacts_groups 表**

```ts
/** 联系人分组/邮件组（按账号隔离） */
export const contactsGroups = sqliteTable('contacts_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
}, (t) => ({
  accNameUq: uniqueIndex('uq_contacts_groups_account_name').on(t.accountId, t.name),
}))

/** 联系人（按账号隔离，email 在账号内唯一） */
export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  note: text('note'),
  avatarPath: text('avatar_path'),
  groupId: integer('group_id'),
  contactCount: integer('contact_count').notNull().default(0),
  lastContactedAt: integer('last_contacted_at', { mode: 'timestamp' }),
}, (t) => ({
  accEmailUq: uniqueIndex('uq_contacts_account_email').on(t.accountId, t.email),
  accNameIdx: index('idx_contacts_account_name').on(t.accountId, t.name),
  accGroupIdx: index('idx_contacts_account_group').on(t.accountId, t.groupId),
}))
```

> **外键说明：** `contacts.account_id` → `accounts.id`、`contacts.group_id` → `contacts_groups.id`。better-sqlite3 默认不开 `PRAGMA foreign_keys`，FK 作逻辑约束 + 索引使用，删除分组时由 repo 层 `UPDATE contacts SET group_id=NULL WHERE group_id=?`（解除关联而非级联，联系人保留）。

- [ ] **Step 2: 生成迁移** `npm run db:generate`（产出 contacts_groups / contacts 建表 SQL，含两表唯一索引与辅助索引）。

- [ ] **Step 3: 运行迁移测试确认两表存在** `npx vitest run src/__tests__/db/migration.test.ts` → PASS（迁移测试需覆盖 contacts/contacts_groups 行）。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): contacts + contacts_groups tables (account-scoped)"
git push
```

---

### Task 2: contacts repo + email 解析

**Files:**
- Create: `src/lib/contacts/parse-emails.ts`
- Create: `src/lib/contacts/repo.ts`
- Test: `src/__tests__/contacts/parse-emails.test.ts`、`src/__tests__/contacts/repo.test.ts`

- [ ] **Step 1: 写 parse-emails 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseAddresses } from '@/lib/contacts/parse-emails'

describe('parseAddresses', () => {
  it('解析 "Name <a@b>" 单个', () => {
    expect(parseAddresses('张三 <zhangsan@x.com>')).toEqual([{ name: '张三', email: 'zhangsan@x.com' }])
  })
  it('解析逗号分隔多个（含混合）', () => {
    expect(parseAddresses('张三 <a@x>, b@y.com, 李四 <c@z>')).toEqual([
      { name: '张三', email: 'a@x' },
      { name: '', email: 'b@y.com' },
      { name: '李四', email: 'c@z' },
    ])
  })
  it('纯邮箱无尖括号', () => {
    expect(parseAddresses('only@x.com')).toEqual([{ name: '', email: 'only@x.com' }])
  })
  it('空/null → []', () => {
    expect(parseAddresses(null as any)).toEqual([])
    expect(parseAddresses('   ')).toEqual([])
  })
  it('email 小写化去空白', () => {
    expect(parseAddresses(' <A@X.com >')).toEqual([{ name: '', email: 'a@x.com' }])
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `parseAddresses(raw: string | null): { name: string; email: string }[]`**
  - 空串/null → `[]`。
  - 按 `,` 分段，每段 `trim`。
  - 每段匹配 `/^\s*(.*?)\s*<([^>]+)>\s*$/` → name=组1、email=组2 去尖括号；否则若整段就是邮箱 `/^[\w.+-]+@[\w.-]+$/` → name=''、email=段。
  - email 统一 `trim().toLowerCase()`；name `trim()`；email 为空或非法的段丢弃。
  - 返回去重（按 email，保留首次 name）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 写 repo 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import {
  createContact, upsertByEmail, getContact, updateContact, deleteContact,
  listContacts, bumpContact, createGroup, listGroups, groupMembers, deleteGroup,
} from '@/lib/contacts/repo'

describe('contacts repo', () => {
  it('createContact 唯一(account,email) 冲突返回既有', () => {
    const db = memDb()
    const a = createContact(db, { accountId: 1, name: '张三', email: 'z@x.com' })
    const b = createContact(db, { accountId: 1, name: '张三丰', email: 'z@x.com' })
    expect(a.id).toBe(b.id)
    expect(b.name).toBe('张三') // 不覆盖
  })
  it('upsertByEmail 新建返回 {created:true}', () => {
    const db = memDb()
    const r = upsertByEmail(db, { accountId: 1, email: 'new@x.com', name: 'New' })
    expect(r.created).toBe(true)
    expect(r.contact.email).toBe('new@x.com')
  })
  it('upsertByEmail 既有且 name 非空 → 更新 name，返回 created:false', () => {
    const db = memDb()
    createContact(db, { accountId: 1, name: '', email: 'e@x.com' })
    const r = upsertByEmail(db, { accountId: 1, email: 'e@x.com', name: '有了' })
    expect(r.created).toBe(false)
    expect(getContact(db, r.contact.id)!.name).toBe('有了')
  })
  it('bumpContact contact_count+1 且 lastContactedAt 更新', () => {
    const db = memDb()
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com' })
    bumpContact(db, { accountId: 1, email: 'a@x.com', name: 'A' })
    const got = getContact(db, c.id)!
    expect(got.contactCount).toBe(1)
    expect(got.lastContactedAt).not.toBeNull()
  })
  it('bumpContact 不存在则 upsert 新建并 count=1', () => {
    const db = memDb()
    const r = bumpContact(db, { accountId: 1, email: 'fresh@x.com', name: 'Fresh' })
    expect(r.contact.contactCount).toBe(1)
  })
  it('分组 + groupMembers', () => {
    const db = memDb()
    const g = createGroup(db, { accountId: 1, name: '团队' })
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com', groupId: g.id })
    expect(groupMembers(db, g.id).map(m => m.id)).toContain(c.id)
  })
  it('deleteGroup 解除关联保留联系人 (group_id=NULL)', () => {
    const db = memDb()
    const g = createGroup(db, { accountId: 1, name: '团队' })
    const c = createContact(db, { accountId: 1, name: 'A', email: 'a@x.com', groupId: g.id })
    deleteGroup(db, g.id)
    expect(getContact(db, c.id)!.groupId).toBeNull()
    expect(listGroups(db, 1)).toHaveLength(0)
  })
})
```

- [ ] **Step 6: 运行确认失败** → FAIL。

- [ ] **Step 7: 实现 repo（全部用 drizzle PreparedStatement / getDb 的 better-sqlite3 原生 prepared statements，事务包裹写）**
  - `createContact(db, { accountId, name, email, phone?, note?, avatarPath?, groupId? })`：`INSERT ... ON CONFLICT(account_id,email) DO NOTHING RETURNING *`，冲突则 `SELECT` 返回既有（不覆盖任何字段）。
  - `upsertByEmail(db, { accountId, email, name })`：先 `SELECT WHERE account_id=? AND email=?`；存在则 `name` 非空且现 name 为空时 `UPDATE`，返回 `{ created: false, contact }`；不存在则 `createContact`，返回 `{ created: true, contact }`。
  - `bumpContact(db, { accountId, email, name })`：`upsertByEmail` → `UPDATE contacts SET contact_count=contact_count+1, last_contacted_at=? WHERE id=?`（`?=Date.now()` ms epoch）。返回 `{ contact }`（已 bump 后的行）。整个操作事务包裹。
  - `getContact(db, id)`、`updateContact(db, id, patch)`、`deleteContact(db, id)`。
  - `listContacts(db, accountId, { groupId?, q? })`：按 accountId；`groupId` 过滤；`q` 对 name/email 做 `LIKE %q%`；`ORDER BY contact_count DESC, last_contacted_at DESC`（常用置顶）。
  - `createGroup(db, { accountId, name })`：`INSERT ... ON CONFLICT(account_id,name) DO NOTHING RETURNING *`，冲突返回既有。`updateGroup`、`deleteGroup`（先 `UPDATE contacts SET group_id=NULL WHERE group_id=?` 再删组）。`listGroups(db, accountId)`、`groupMembers(db, groupId)`。

- [ ] **Step 8: 运行确认通过** → PASS。

- [ ] **Step 9: Commit**

```bash
git add src/lib/contacts/repo.ts src/lib/contacts/parse-emails.ts src/__tests__/contacts/repo.test.ts src/__tests__/contacts/parse-emails.test.ts
git commit -m "feat(contacts): repo (upsert/bump) + parse-addresses helper"
git push
```

---

### Task 3: 自动补全聚合查询 + API

**Files:**
- Create: `src/lib/contacts/autocomplete.ts`
- Create: `src/app/api/contacts/autocomplete/route.ts`
- Test: `src/__tests__/contacts/autocomplete.test.ts`、`src/__tests__/api/contacts-autocomplete.test.ts`

**关键设计：** 自动补全 = 通讯录匹配 ∪ 历史通信记录聚合，**合并后排序**：
1. 通讯录：`contacts WHERE account_id=? AND (name LIKE q OR email LIKE q)`，每条带 `source: 'addressbook'`、`weight = contact_count`。
2. 历史：对 `messages WHERE account_id=?` 的 `from`/`to`/`cc`/`bcc` 用 `parseAddresses` 解析，过滤 `email LIKE q`，在 JS 里按 email 聚合 `freq = 出现次数`，带 name（取首次非空）；每条带 `source: 'history'`、`weight = freq`。
3. 合并去重（按 email）：同一 email 通讯录与历史都有时合并——`source: 'both'`、`weight = contact_count + freq`（通讯录 count + 历史频次）。
4. 排序：`source==='both'/'addressbook'` 优先（在通讯录的 > 仅历史的），同档按 `weight DESC`，再按 `last_contacted_at DESC`。
5. 取前 8 条返回 `{ name, email, source, weight, inAddressBook }`。

- [ ] **Step 1: 写 autocomplete 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { autocomplete } from '@/lib/contacts/autocomplete'

describe('autocomplete', () => {
  it('通讯录匹配 + 历史匹配合并，通讯录置顶', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, recipient, cc, bcc) VALUES
      (1,'<m1>',1,'s','历史人 <hist@x.com>','me@x.com',NULL,NULL),
      (2,'<m2>',1,'s','hist@x.com','me@x.com',NULL,NULL),
      (3,'<m3>',1,'s','other@y.com',NULL,NULL,NULL)`)
    db.exec(`INSERT INTO contacts (id, account_id, name, email, contact_count) VALUES (10,1,'通讯录人','ab@x.com',5)`)
    const r = autocomplete(db, { accountId: 1, q: 'x.com', limit: 8 })
    const emails = r.map(x => x.email)
    expect(emails).toContain('ab@x.com')
    expect(emails).toContain('hist@x.com')
    // 通讯录 ab 排在仅历史 hist 之前
    expect(emails.indexOf('ab@x.com')).toBeLessThan(emails.indexOf('hist@x.com'))
  })
  it('同一 email 通讯录+历史都有 → source=both 且 weight=count+freq', () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, recipient) VALUES
      (1,'<m1>',1,'dup@x.com','me'),(2,'<m2>',1,'dup@x.com','me')`)
    db.exec(`INSERT INTO contacts (id, account_id, name, email, contact_count) VALUES (1,1,'Dup','dup@x.com',3)`)
    const r = autocomplete(db, { accountId: 1, q: 'dup' })
    expect(r[0].source).toBe('both')
    expect(r[0].weight).toBe(5) // count 3 + freq 2
    expect(r[0].inAddressBook).toBe(true)
  })
  it('limit 截断', () => {
    const db = memDb()
    for (let i = 0; i < 20; i++) db.exec(`INSERT INTO contacts (account_id,name,email) VALUES (1,'n${i}','e${i}@x.com')`)
    expect(autocomplete(db, { accountId: 1, q: 'x.com', limit: 8 })).toHaveLength(8)
  })
  it('空 q → 返回最近常用', () => {
    const db = memDb()
    db.exec(`INSERT INTO contacts (account_id,name,email,contact_count) VALUES (1,'A','a@x.com',2)`)
    expect(autocomplete(db, { accountId: 1, q: '', limit: 8 })[0].email).toBe('a@x.com')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `autocomplete(db, { accountId, q, limit = 8 }): AutocompleteHit[]`**

```ts
export interface AutocompleteHit {
  name: string
  email: string
  source: 'addressbook' | 'history' | 'both'
  weight: number
  inAddressBook: boolean
  lastContactedAt: number | null
}

export function autocomplete(db, { accountId, q, limit = 8 }): AutocompleteHit[] {
  const like = q && q.trim() ? `%${q.trim().toLowerCase()}%` : null

  // 1) 通讯录
  const abRows = db.prepare(
    `SELECT name, email, contact_count AS contactCount, last_contacted_at AS lastContactedAt
     FROM contacts WHERE account_id=@accountId ${like ? 'AND (LOWER(email) LIKE @like OR LOWER(name) LIKE @like)' : ''}
     ORDER BY contact_count DESC, last_contacted_at DESC`
  ).all(...bindLike({ accountId, like })).map(row => ({ ...row }))
  const abMap = new Map<string, any>()
  for (const r of abRows) abMap.set(r.email.toLowerCase(), { name: r.name, email: r.email, count: r.contactCount, lastContactedAt: r.lastContactedAt })

  // 2) 历史:扫 messages 的 from/to/cc/bcc 解析聚合
  const msgRows = db.prepare(
    `SELECT sender AS sender, recipient AS \`to\`, cc, bcc FROM messages WHERE account_id=@accountId`
  ).all(accountId)
  const hist = new Map<string, { name: string; freq: number }>()
  for (const row of msgRows) {
    const addrs = [
      ...parseAddresses(row.sender),
      ...parseAddresses(row.to),
      ...parseAddresses(row.cc),
      ...parseAddresses(row.bcc),
    ]
    for (const a of addrs) {
      const e = a.email.toLowerCase()
      if (like && !e.includes(like.replace(/%/g, '')) && !(a.name || '').toLowerCase().includes(like.replace(/%/g, ''))) continue
      const cur = hist.get(e)
      if (cur) { cur.freq += 1; if (!cur.name && a.name) cur.name = a.name }
      else hist.set(e, { name: a.name, freq: 1 })
    }
  }

  // 3) 合并
  const merged = new Map<string, AutocompleteHit>()
  for (const [e, v] of abMap) {
    const h = hist.get(e)
    merged.set(e, {
      name: v.name, email: v.email,
      source: h ? 'both' : 'addressbook',
      weight: v.count + (h ? h.freq : 0),
      inAddressBook: true,
      lastContactedAt: v.lastContactedAt,
    })
  }
  for (const [e, h] of hist) {
    if (merged.has(e)) continue
    const ab = abMap.get(e)
    merged.set(e, {
      name: h.name, email: e,
      source: ab ? 'both' : 'history',
      weight: (ab ? ab.count : 0) + h.freq,
      inAddressBook: !!ab,
      lastContactedAt: ab ? ab.lastContactedAt : null,
    })
  }

  // 4) 排序:在通讯录优先,然后 weight DESC,再 lastContactedAt DESC
  return [...merged.values()]
    .sort((a, b) => {
      const ai = a.inAddressBook ? 0 : 1, bi = b.inAddressBook ? 0 : 1
      if (ai !== bi) return ai - bi
      if (b.weight !== a.weight) return b.weight - a.weight
      return (b.lastContactedAt || 0) - (a.lastContactedAt || 0)
    })
    .slice(0, limit)
}
```

（`bindLike` 辅助：like 非空时 `[@accountId,@like,@like]`，否则 `[@accountId]`；`@` 命名参数或位置参数按 prepared statement 风格统一。）

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 实现 `GET /api/contacts/autocomplete`**：读 `?q=`、`?accountId=`（默认取首个 active account）→ `autocomplete(db,{accountId,q,limit:8})` → 200 `{ hits }`。`accountId` 缺失（无账号，plan-01/02 之前）时查"通讯录 + 所有 account_id 的 messages"，兼容降级。

- [ ] **Step 6: 写 API 测试**（`?q=` 返回命中、通讯录置顶、limit、空 q）→ 运行通过。

- [ ] **Step 7: Commit**

```bash
git add src/lib/contacts/autocomplete.ts src/app/api/contacts/autocomplete/route.ts src/__tests__/contacts/autocomplete.test.ts src/__tests__/api/contacts-autocomplete.test.ts
git commit -m "feat(contacts): autocomplete = addressbook ∪ history, frequency-ranked"
git push
```

---

### Task 4: 收信/发信自动 bumpContact（常用度）

**Files:**
- Modify: `src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts`
- Modify: `src/app/api/send/route.ts`
- Test: `src/__tests__/contacts/bump-on-ingest.test.ts`

**关键设计：** 收信入库（fetch/scheduler）成功后，对 `from` 的每个地址 `bumpContact`；发信成功（send）后，对 `to`/`cc`/`bcc` 每个地址 `bumpContact`。`accountId` 取该消息所属账号。所有 bump 在事务外（入库事务已 commit 后），单条 bump 失败不影响邮件入库。

- [ ] **Step 1: 写失败测试**（模拟一封入库 → from 地址进通讯录且 count=1；再收一封同地址 → count=2）。

```ts
describe('bumpContact on ingest', () => {
  it('收信后 from 地址 bump 进通讯录', () => {
    const db = memDb()
    ingestMessage(db, { accountId: 1, messageId: '<m1>', from: '张三 <z@x.com>', to: 'me@x.com' })
    const c = db.prepare('SELECT * FROM contacts WHERE email=?').get('z@x.com') as any
    expect(c).toBeTruthy()
    expect(c.contact_count).toBe(1)
  })
  it('同 from 再收一封 → count=2', () => {
    const db = memDb()
    ingestMessage(db, { accountId: 1, messageId: '<m1>', from: 'z@x.com', to: 'me@x.com' })
    ingestMessage(db, { accountId: 1, messageId: '<m2>', from: 'z@x.com', to: 'me@x.com' })
    expect((db.prepare('SELECT contact_count FROM contacts WHERE email=?').get('z@x.com') as any).contact_count).toBe(2)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现 `bumpFromMessage(db, { accountId, from, to, cc, bcc })`**（放 `src/lib/contacts/repo.ts` 或新 `bump.ts`）：`parseAddresses` 拆出全部地址，对每个 `bumpContact(db,{accountId,email,name})`。**收信**调 `bumpFromMessage({from})`；**发信**调 `bumpFromMessage({to,cc,bcc})`（发件人自己不入库为联系人）。

- [ ] **Step 4: 接线**：
  - `src/app/api/fetch/route.ts` 与 `src/lib/scheduler/index.ts`：邮件 `db.insert(messages)` 成功后调 `bumpFromMessage(getDb(), { accountId, from: msg.from })`。
  - `src/app/api/send/route.ts`：发送成功且写 `messages(direction='out')` 后调 `bumpFromMessage(getDb(), { accountId, to: msg.to, cc: msg.cc, bcc: msg.bcc })`。
  - 接线处用 try/catch 包裹，日志降级（bump 失败不阻断主流程）。

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/contacts/repo.ts src/lib/scheduler/index.ts src/app/api/fetch/route.ts src/app/api/send/route.ts src/__tests__/contacts/bump-on-ingest.test.ts
git commit -m "feat(contacts): auto bump contact_count/last_contacted on receive + send"
git push
```

---

### Task 5: 联系人 CRUD API

**Files:**
- Create: `src/app/api/contacts/route.ts`、`src/app/api/contacts/[id]/route.ts`
- Test: `src/__tests__/api/contacts.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('contacts API', () => {
  it('POST /api/contacts 创建', async () => { /* {accountId,name,email,phone} → 201, 返回 contact */ })
  it('POST 同 email 返回既有 200', async () => {})
  it('GET /api/contacts?accountId=1&q=张 列表+搜索', async () => {})
  it('GET /api/contacts?accountId=1&groupId=2 按分组', async () => {})
  it('GET /api/contacts/[id] 单条 + group 名', async () => {})
  it('PATCH /api/contacts/[id] 改 name/phone/note/group', async () => {})
  it('DELETE /api/contacts/[id] 删除', async () => {})
  it('accountId 缺失 → 400', async () => {})
  it('email 非法 → 400', async () => {})
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `POST /api/contacts`：校验 `accountId` 必填、`email` 正则合法 → 否则 400；`createContact`，冲突返回 200 + 既有。
  - `GET /api/contacts`：`?accountId=` 必填；`?q=`、`?groupId=` 透传 `listContacts`。
  - `GET /api/contacts/[id]`：`getContact` + join `contacts_groups.name` 作 `groupName`；不存在 404。
  - `PATCH /api/contacts/[id]`：`updateContact`（name/email/phone/note/avatarPath/groupId）。
  - `DELETE /api/contacts/[id]`：`deleteContact` → 204。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/contacts/route.ts src/app/api/contacts/[id]/route.ts src/__tests__/api/contacts.test.ts
git commit -m "feat(api): contacts CRUD with group join + search"
git push
```

---

### Task 6: 分组 CRUD + 群发展开

**Files:**
- Create: `src/app/api/contacts/groups/route.ts`、`src/app/api/contacts/groups/[id]/route.ts`
- Test: `src/__tests__/api/contacts-groups.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('contacts groups API', () => {
  it('POST /api/contacts/groups 创建', async () => { /* {accountId,name} → 201 */ })
  it('POST 同名返回既有 200', async () => {})
  it('GET /api/contacts/groups?accountId=1 列表含成员数', async () => {})
  it('PATCH /api/contacts/groups/[id] 改名', async () => {})
  it('DELETE /api/contacts/groups/[id] 解除关联(成员 group_id=NULL) + 204', async () => { /* 成员保留 */ })
  it('GET /api/contacts/groups/[id]/members 展开成员 → ComposeMail 群发用', async () => { /* 返回 [{name,email}] */ })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**
  - `POST /api/contacts/groups`：`createGroup`，冲突返回既有。
  - `GET /api/contacts/groups?accountId=`：`listGroups` + 每组 `count(*)` 成员数。
  - `PATCH /api/contacts/groups/[id]`：`updateGroup`（name）。
  - `DELETE /api/contacts/groups/[id]`：`deleteGroup`（内部先解除成员关联）→ 204。
  - `GET /api/contacts/groups/[id]/members`：`groupMembers` → `{ members: [{name,email}] }`（ComposeMail 群发时前端拉这个展开成 `to` 列表）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/contacts/groups src/__tests__/api/contacts-groups.test.ts
git commit -m "feat(api): contact groups CRUD + members expansion for bulk send"
git push
```

---

### Task 7: vCard / CSV 导入导出

**Files:**
- Create: `src/lib/contacts/import-export.ts`
- Create: `src/app/api/contacts/import/route.ts`、`src/app/api/contacts/export/route.ts`
- Test: `src/__tests__/contacts/import-export.test.ts`、`src/__tests__/api/contacts-import-export.test.ts`

**关键设计：** 解析真实内联，不引 vCard 库。vCard 3.0 单条形如：
```
BEGIN:VCARD
VERSION:3.0
FN:张三
N:三;张;;;
TEL;TYPE=CELL:13800000000
EMAIL:z@x.com
NOTE:备注
END:VCARD
```
CSV 表头固定 `name,email,phone,note`。导入对每条 `upsertByEmail`（accountId 来自请求或默认 active account）。导出按 accountId 全量序列化。

- [ ] **Step 1: 写 import-export 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseVCard, toVCard, parseCsv, toCsv } from '@/lib/contacts/import-export'

describe('parseVCard', () => {
  it('解析单条', () => {
    const vcf = ['BEGIN:VCARD','VERSION:3.0','FN:张三','EMAIL:z@x.com','TEL;TYPE=CELL:13800','NOTE:hi','END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toEqual([{ name: '张三', email: 'z@x.com', phone: '13800', note: 'hi' }])
  })
  it('解析多条', () => {
    const vcf = ['BEGIN:VCARD','VERSION:3.0','FN:A','EMAIL:a@x.com','END:VCARD','BEGIN:VCARD','VERSION:3.0','FN:B','EMAIL:b@x.com','END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toHaveLength(2)
  })
  it('缺 email 的条目丢弃', () => {
    const vcf = ['BEGIN:VCARD','VERSION:3.0','FN:NoEmail','END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toEqual([])
  })
  it('CRLF 换行兼容', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A\r\nEMAIL:a@x.com\r\nEND:VCARD\r\n'
    expect(parseVCard(vcf)[0].email).toBe('a@x.com')
  })
})
describe('toVCard', () => {
  it('序列化含 FN/EMAIL/TEL/NOTE', () => {
    const out = toVCard([{ name: '张三', email: 'z@x.com', phone: '13800', note: 'n' }])
    expect(out).toContain('BEGIN:VCARD')
    expect(out).toContain('FN:张三')
    expect(out).toContain('EMAIL:z@x.com')
    expect(out).toContain('TEL;TYPE=CELL:13800')
    expect(out).toContain('END:VCARD')
  })
})
describe('parseCsv / toCsv', () => {
  it('往返', () => {
    const rows = [{ name: 'A', email: 'a@x.com', phone: '1', note: 'n' }, { name: 'B', email: 'b@x.com', phone: '', note: '' }]
    const csv = toCsv(rows)
    expect(csv).toContain('name,email,phone,note')
    expect(parseCsv(csv)).toEqual(rows)
  })
  it('CSV 含逗号/引号正确转义', () => {
    const rows = [{ name: 'A, B', email: 'a@x.com', phone: '', note: 'he said "hi"' }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现（真实解析代码）**

```ts
export interface ContactDto { name: string; email: string; phone?: string; note?: string }

export function parseVCard(raw: string): ContactDto[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
  const out: ContactDto[] = []
  let cur: Partial<ContactDto> | null = null
  for (const line of lines) {
    const up = line.toUpperCase()
    if (up === 'BEGIN:VCARD') { cur = { name: '', email: '' }; continue }
    if (up === 'END:VCARD') {
      if (cur && cur.email) out.push({ name: cur.name || '', email: cur.email.toLowerCase(), phone: cur.phone, note: cur.note })
      cur = null; continue
    }
    if (!cur) continue
    const [kRaw, ...rest] = line.split(':')
    if (rest.length < 1) continue
    const value = rest.join(':')
    const key = kRaw.split(';')[0].toUpperCase()
    if (key === 'FN' || key === 'N') {
      // N: 三;张;;; → 取前两段反序; FN 优先
      if (!cur.name) {
        if (key === 'N') { const parts = value.split(';'); cur.name = (parts[1] + ' ' + parts[0]).trim() }
        else cur.name = value
      }
    }
    else if (key === 'EMAIL') cur.email = value.trim().toLowerCase()
    else if (key === 'TEL') cur.phone = value
    else if (key === 'NOTE') cur.note = value
  }
  return out
}

export function toVCard(rows: ContactDto[]): string {
  return rows.map(r => [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${r.name || r.email}`,
    r.name ? `N:${escapeN(r.name)}` : null,
    r.phone ? `TEL;TYPE=CELL:${r.phone}` : null,
    `EMAIL:${r.email}`,
    r.note ? `NOTE:${esc(r.note)}` : null,
    'END:VCARD',
  ].filter(Boolean).join('\n')).join('\n')
}

function escapeN(name: string): string { const p = name.split(/\s+/); return `${p[1] || ''};${p[0] || ''};;;` }
function esc(s: string): string { return s.replace(/\\n/g, ' ').replace(/\r?\n/g, ' ') }

export function parseCsv(raw: string): ContactDto[] {
  const rows = csvParse(raw) // 二维数组
  const header = rows[0].map(h => h.trim().toLowerCase())
  const idx = (k: string) => header.indexOf(k)
  const ni = idx('name'), ei = idx('email'), pi = idx('phone'), oi = idx('note')
  return rows.slice(1)
    .filter(r => r[ei])
    .map(r => ({ name: ni >= 0 ? r[ni] || '' : '', email: (r[ei] || '').toLowerCase().trim(), phone: pi >= 0 ? r[pi] || '' : '', note: oi >= 0 ? r[oi] || '' : '' }))
}

export function toCsv(rows: ContactDto[]): string {
  const header = 'name,email,phone,note'
  const body = rows.map(r => [r.name || '', r.email || '', r.phone || '', r.note || ''].map(csvCell).join(','))
  return [header, ...body].join('\n')
}
function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}
// 标准 RFC4180 CSV 解析(支持引号转义/逗号/换行)
function csvParse(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inQuotes) {
      if (c === '"') { if (raw[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && raw[i + 1] === '\n') i++
        row.push(field); rows.push(row); row = []; field = ''
      } else field += c
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length && r.some(c => c.trim() !== ''))
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 实现 `POST /api/contacts/import`**：body `{ accountId, format: 'vcard'|'csv', data: string }` → 对每条 `upsertByEmail`，返回 `{ imported, skipped }`。`GET /api/contacts/export?accountId=&format=vcard|csv` → 序列化全量，`Content-Type: text/vcard` 或 `text/csv`，`Content-Disposition: attachment`。

- [ ] **Step 6: 写 API 测试**（导入 vcard 后可查到、重复导入幂等、导出 vcard/csv 含正确头）→ 运行通过。

- [ ] **Step 7: Commit**

```bash
git add src/lib/contacts/import-export.ts src/app/api/contacts/import/route.ts src/app/api/contacts/export/route.ts src/__tests__/contacts/import-export.test.ts src/__tests__/api/contacts-import-export.test.ts
git commit -m "feat(contacts): vCard 3.0 + CSV import/export"
git push
```

---

### Task 8: 通讯录独立页 UI + 详情 + 入口

**Files:**
- Create: `src/app/contacts/page.tsx`、`src/app/contacts/[id]/page.tsx`
- Modify: `src/components/nav/Sidebar.tsx`、`src/app/settings/`（加"联系人"入口或链到 /contacts）

- [ ] **Step 1: 通讯录列表页 `/contacts`**：
  - 左侧分组侧栏（"全部"+ 各组名 + 成员数），点击按 `groupId` 过滤。
  - 顶部搜索框（`q` 实时过滤）、"新建联系人"按钮、"导入"/"导出"按钮。
  - 主区名片网格/列表：每张名片含头像（`avatarPath` 或 name 首字母占位）+ 姓名 + email + phone + 备注 + `contact_count`/`last_contacted_at`（常用度），点名片进详情。
  - 新建/编辑抽屉：姓名/email/phone/note/分组下拉；提交 `POST/PATCH /api/contacts`。
  - 导入按钮：弹 textarea 贴 vCard/CSV + 选格式 → `POST /api/contacts/import`，提示 imported/skipped。导出按钮：`window.location = '/api/contacts/export?format=vcard'`。
  - `accountId` 取 active 账号；多账号时顶部账号切换。

- [ ] **Step 2: 联系人详情页 `/contacts/[id]`**：
  - 完整名片（头像/姓名/email/phone/note/分组）+ "编辑"/"删除"。
  - **往来邮件**：`GET /api/messages?contactId=` 或前端按 `email` 过滤 messages 的 from/to（与子项目 7 搜索联动亦可）—— 显示与该联系人全部收发邮件列表，点邮件跳 `/mails/[id]`。
  - "发邮件给 TA" 按钮 → 跳 compose 预填 `to`。

- [ ] **Step 3: Sidebar / settings 入口**：Sidebar 加"联系人"导航项 → `/contacts`；settings 页加"联系人管理"链接到 `/contacts`。

- [ ] **Step 4: 手测**：新建联系人 → 列表出现；按分组过滤；编辑保存；导入 vCard 后可查；导出下载；详情页往来邮件正确；点邮件双向跳转。

- [ ] **Step 5: Commit**

```bash
git add src/app/contacts src/components/nav/Sidebar.tsx src/app/settings
git commit -m "feat(ui): contacts page (cards/groups/search/import-export) + detail + nav entry"
git push
```

---

### Task 9: ComposeMail 收件人自动补全

**Files:**
- Modify: `src/components/ComposeMail.tsx`（及 plan-05 的 EmailInput 若有）

- [ ] **Step 1: 接自动补全下拉**：收件人输入框（`to`，及 plan-05 的 `cc`/`bcc`）绑 `onChange`：
  - debounce ~150ms，对当前输入 token（取光标所在逗号后的片段）调 `GET /api/contacts/autocomplete?q=token&accountId=`。
  - 下拉显示前 8 条：每条 `name <email>` + 小角标（通讯录 📇 / 历史频次），键盘 ↑↓ 选中、Enter/Tab 选中、Esc 关闭、鼠标点击选中。
  - 选中后把该 token 替换为 `Name <email>, `（保留已输入的其他收件人），光标移到末尾继续输入。
  - 高频置顶已由 API 排序保证（通讯录 + weight）。

- [ ] **Step 2: 群发**：若输入框值或补全结果对应一个分组，提供"展开为组成员"——拉 `/api/contacts/groups/[id]/members` 展开成多个 `Name <email>` 填入 `to`。（可选：补全下拉里直接列出"组:团队 (3 人)"。）

- [ ] **Step 3: 手测**：输入 `z` 联想出通讯录+历史；↑↓ Enter 选中正确替换；群发到组多人；cc/bcc 同样联想。

- [ ] **Step 4: Commit**

```bash
git add src/components/ComposeMail.tsx
git commit -m "feat(compose): recipient autocomplete from addressbook + history, freq-ranked"
git push
```

---

### Task 10: 邮件详情页"加入通讯录" + 发件人名片

**Files:**
- Modify: `src/app/mails/[id]/page.tsx`

- [ ] **Step 1: 发件人旁按钮**：详情页发件人（`from`）email 旁渲染：
  - 若该 email 已在通讯录 → 显示联系人姓名（从 `/api/contacts` 查或 autocomplete 命中 `inAddressBook`），点之跳 `/contacts/[id]`（双向跳转：邮件点发件人看名片）。
  - 若不在 → "加入通讯录"按钮 → `POST /api/contacts { accountId, name: fromName, email: fromEmail }` → 成功后按钮变"已加入"并成可点跳详情。
- [ ] **Step 2: 收件人/抄送**：to/cc 每个地址同理可点跳联系人详情或"加入通讯录"（简化：仅发件人必做，to/cc 复用同一组件）。
- [ ] **Step 3: 手测**：一封陌生发件人邮件 → "加入通讯录"成功 → 再看变名片可跳联系人详情；联系人详情页往来邮件里能看到这封（双向跳转闭环）。

- [ ] **Step 4: Commit**

```bash
git add src/app/mails/[id]/page.tsx
git commit -m "feat(ui): add-to-contacts + sender card cross-link on mail detail"
git push
```

---

## 验收标准

- [ ] 联系人 CRUD：新建/编辑/删除/搜索/按分组过滤均生效；同 email 幂等不重复。
- [ ] ComposeMail 收件人输入即联想：来源 = 通讯录 ∪ 历史通信记录；通讯录条目与高频项置顶；↑↓ Enter 选中替换正确；cc/bcc 同样联想。
- [ ] 分组群发：选组展开为多收件人，发送 `to` 正确含全部成员。
- [ ] 导入 vCard / CSV 后联系人可查、可联想；导出 vCard / CSV 格式正确（含转义/多联系人）；重复导入幂等。
- [ ] 邮件详情页"加入通讯录"成功；发件人已存时显示姓名并可跳名片；联系人 ↔ 邮件双向跳转闭环。
- [ ] 收信/发信自动更新常用度：`contact_count` +1、`last_contacted_at` 刷新；同地址累加正确。
- [ ] `npm test` 全绿（contacts repo/parse-emails/autocomplete/import-export、contacts/groups/autocomplete/import-export API、bump-on-ingest）。
- [ ] `npx tsc --noEmit` 无类型错误。

## 依赖

- 子项目 2：`accounts` 表 + `messages.account_id`（contacts 按 accountId 隔离、自动补全历史查询的 accountId 过滤、bumpContact 需 accountId）。无账号时降级（全库 messages）。
- 子项目 5：`messages.to/cc/bcc` 拆分列 + ComposeMail 收件人输入流（自动补全接 to/cc/bcc 输入、群发展开写入 to）。若 to/cc/bcc 尚未拆分（仍是单 `recipient` 列），autocomplete 与 bumpFromMessage 退化为只读 `recipient`。

## 风险

- **自动补全历史扫描成本**：`autocomplete` 每次扫该账号全部 messages 的 4 列并在 JS 解析聚合——本地单机邮件量大（数万）时单次可能 >100ms。缓解：debounce 150ms + limit 8；P2 加物化表 `email_stats(email, freq, last_seen)` 由 bump 流水线增量维护，autocomplete 改查该表（留 TODO）。
- **accountId 来源**：plan-01/02 之前的存量 messages 无 `account_id`（NULL），自动补全历史查询与 bump 需处理 NULL（归到默认账号或全库），过渡期降级。
- **vCard/CSV 解析鲁棒性**：不同客户端导出的 vCard 字段大小写/换行/FN vs N 差异大；CSV 编码（GBK vs UTF-8）可能乱码。缓解：大小写不敏感解析、CRLF 兼容、CSV 尝试 UTF-8 解码（本地中文邮件客户端多为 UTF-8/GBK，乱码时在 UI 提示，P2 加 chardet）。
- **常用度 bump 失败隔离**：bump 在邮件入库事务外，若 bump 抛错不能影响收信/发信主流程——接线处必须 try/catch 降级 + 日志。
- **群发收件人上限**：一次性 `to` 几十个地址可能被服务商限流/拒收；缓解：UI 文案提示、P2 走 outbox 分批发送（子项目 13）。
- **联系人去重**：同一人多 email 不合并（本子项目 email 为唯一键）；P2 可加"合并联系人"功能。
- execute 前补全每个任务的 TDD 微步骤（先红后绿）。
