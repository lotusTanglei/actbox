// src/lib/sync/syncEngine.ts
// 多账号同步引擎:遍历启用账号 → getAdapter(id).fetch(INBOX, since) →
// 去重(按 messageId 唯一约束)+ 抽取待办 + 写库(填 accountId/folder/imapUid)。
// fetch route 与 scheduler 共用,避免逻辑三处重复。增量同步的 UIDVALIDITY/UID
// 精确回写属 plan-03,这里用 since 时间窗 + messageId 去重做近似增量。

import { getDb, getRawDb } from '@/lib/db'
import { accounts, messages, todos } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAdapter, listActiveAccountIds, ensureBootstrapAccount } from '@/lib/adapter/mail/adapterRegistry'
import { extractTodos } from '@/lib/extractor'
import { extractAttachments } from '@/lib/attachments/extract'
import { getAttachmentsRoot } from '@/lib/attachments/store'
import { htmlToText } from '@/lib/db/body-html-text'

type Db = ReturnType<typeof getDb>

export interface AccountSyncResult {
  accountId: number
  email: string
  fetched: number
  newTodos: number
  skipped: number
  error?: string
}

export interface SyncSummary {
  results: AccountSyncResult[]
  totalFetched: number
  totalNewTodos: number
  accountErrors: number
}

const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000 // 首次同步回看 7 天
const OVERLAP_MS = 5 * 60 * 1000 // 重叠窗口防边界丢邮件(IMAP since 常按日粒度)

/** 同步所有启用账号(env 引导 → 列账号 → 逐个 fetch/抽取/入库)。 */
export async function syncActiveAccounts(): Promise<SyncSummary> {
  const db = getDb()
  ensureBootstrapAccount(db)
  const ids = listActiveAccountIds(db)
  const results: AccountSyncResult[] = []
  for (const id of ids) {
    results.push(await syncOneAccount(id, db))
  }
  return {
    results,
    totalFetched: results.reduce((n, r) => n + r.fetched, 0),
    totalNewTodos: results.reduce((n, r) => n + r.newTodos, 0),
    accountErrors: results.filter((r) => r.error).length,
  }
}

async function syncOneAccount(accountId: number, db: Db): Promise<AccountSyncResult> {
  const row = db.select().from(accounts).where(eq(accounts.id, accountId)).all()[0] as any
  if (!row) return { accountId, email: '(unknown)', fetched: 0, newTodos: 0, skipped: 0, error: '账号不存在' }

  db.update(accounts).set({ syncStatus: 'syncing', syncError: null }).where(eq(accounts.id, accountId)).run()

  const adapter = getAdapter(accountId, { db })
  if (!adapter) {
    db.update(accounts).set({ syncStatus: 'error', syncError: '适配器不可用' }).where(eq(accounts.id, accountId)).run()
    return { accountId, email: row.email, fetched: 0, newTodos: 0, skipped: 0, error: '适配器不可用' }
  }

  try {
    const lastTs = row.lastSyncedAt
      ? new Date(row.lastSyncedAt.getTime() - OVERLAP_MS)
      : new Date(Date.now() - INITIAL_LOOKBACK_MS)
    const raws = await adapter.fetch({ folder: 'INBOX', since: lastTs })
    const rawDb = getRawDb()
    const attRoot = getAttachmentsRoot()

    let newTodos = 0
    let skipped = 0
    for (const msg of raws) {
      const mid = msg.messageId || `no-id-${accountId}-${msg.imapUid ?? `t${Date.now()}`}`
      // 去重(messageId 唯一约束)
      const existing = db.select({ id: messages.id }).from(messages).where(eq(messages.messageId, mid)).all()
      if (existing.length > 0) {
        skipped++
        continue
      }

      const body = msg.body || ''
      let todoCount = 0
      if (body.trim().length >= 10) {
        const extractResult = await extractTodos(body)
        todoCount = extractResult.todos.length
        for (const todo of extractResult.todos) {
          db.insert(todos)
            .values({
              title: todo.title,
              dueDate: todo.dueDate || null,
              priority: todo.priority || null,
              context: todo.context || null,
              sourceMessageId: mid,
              sourceSubject: msg.subject,
              sourceFrom: msg.from,
            })
            .returning()
            .all()
          newTodos++
        }
      } else {
        // 正文过短:仍记录以免重复拉取,但不抽取待办
        skipped++
      }

      const ins = db
        .insert(messages)
        .values({
          messageId: mid,
          subject: msg.subject,
          from: msg.from,
          to: msg.to ?? null,
          cc: msg.cc ?? null,
          body,
          bodyHtml: msg.bodyHtml || null,
          bodyHtmlText: msg.bodyHtml ? htmlToText(msg.bodyHtml) : null,
          receivedAt: msg.receivedAt,
          accountId,
          folder: msg.folder || 'INBOX',
          imapUid: msg.imapUid ?? null,
          todoCount,
        })
        .returning({ id: messages.id })
        .all()
      const dbMsgId = ins[0]?.id

      // 附件抽取(失败不阻断邮件入库,仅记日志)。plan-04 Task 6。
      if (msg.rawSource && dbMsgId) {
        try {
          await extractAttachments(msg.rawSource, {
            accountId,
            messageId: dbMsgId,
            root: attRoot,
            db: rawDb,
          })
        } catch (e) {
          console.error('[sync] attachment extract failed for', mid, e instanceof Error ? e.message : e)
        }
      }
    }

    db.update(accounts)
      .set({ syncStatus: 'healthy', syncError: null, lastSyncedAt: new Date() })
      .where(eq(accounts.id, accountId))
      .run()

    return { accountId, email: row.email, fetched: raws.length, newTodos, skipped }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    db.update(accounts)
      .set({ syncStatus: 'error', syncError: detail })
      .where(eq(accounts.id, accountId))
      .run()
    return { accountId, email: row.email, fetched: 0, newTodos: 0, skipped: 0, error: detail }
  }
}
