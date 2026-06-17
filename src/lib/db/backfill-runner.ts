// src/lib/db/backfill-runner.ts
// body 全文回填：把疑似被截断（length <= 500）的历史邮件，用 fetchSource 重拉源、
// 回写全文 body/bodyHtml/imap_uid。幂等（回填后 length > 500 不再是候选）。
//
// fetchSource 的真实实现（按 accountId 经 IMAP 重拉源邮件）在 plan-02 的 MailAdapter
// 就绪后注入；本 runner 只负责"找候选 → 调 fetchSource → 回写"的可测纯逻辑。

import type Database from 'better-sqlite3'

export interface BackfillSource {
  body: string
  bodyHtml?: string | null
  imapUid?: number | null
}

export interface BackfillResult {
  total: number
  refilled: number
  skipped: number
  failed: number
}

export async function runBackfill(opts: {
  db: Database.Database
  fetchSource: (accountId: number | null, messageId: string) => Promise<BackfillSource | null>
  dryRun?: boolean
}): Promise<BackfillResult> {
  const candidates = opts.db
    .prepare('SELECT id, account_id, message_id, body FROM messages WHERE length(body) <= 500')
    .all() as { id: number; account_id: number | null; message_id: string; body: string | null }[]

  let refilled = 0
  let skipped = 0
  let failed = 0

  for (const row of candidates) {
    try {
      const fetched = await opts.fetchSource(row.account_id, row.message_id)
      const curLen = row.body?.length ?? 0
      if (!fetched || !fetched.body || fetched.body.length <= curLen) {
        skipped++
        continue
      }
      if (!opts.dryRun) {
        opts.db
          .prepare(
            'UPDATE messages SET body = ?, body_html = COALESCE(?, body_html), imap_uid = COALESCE(?, imap_uid) WHERE id = ?',
          )
          .run(fetched.body, fetched.bodyHtml ?? null, fetched.imapUid ?? null, row.id)
      }
      refilled++
    } catch {
      // 单行失败不中断整体回填
      failed++
    }
  }

  return { total: candidates.length, refilled, skipped, failed }
}
