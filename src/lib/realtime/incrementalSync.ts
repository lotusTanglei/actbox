// src/lib/realtime/incrementalSync.ts
// EXISTS 触发的增量拉取:UID 高水位 → fetch uidRange [last+1, *] → 入库 → 发事件。
// 复用 plan-03 checkUidValidity(UIDVALIDITY 变化重映射)与 messages/repo。plan-06 Task 3。

import type Database from 'better-sqlite3'
import type { MailAdapter } from '@/lib/adapter/types'
import type { MailEvent } from '@/lib/events/types'
import { checkUidValidity } from '@/lib/sync/uidvalidity'
import { upsertMessage, lastUidHighWater, setUidHighWater, recomputeUnread } from '@/lib/messages/repo'

export async function pullIncremental(
  db: Database.Database,
  opts: {
    accountId: number
    folder: string
    adapter: MailAdapter
    publish: (ev: MailEvent) => void
    uidValidity?: number
  },
): Promise<{ inserted: number }> {
  const { accountId, folder, adapter, publish } = opts

  // 1. UIDVALIDITY 变化 → plan-03 重映射(已清旧 imap_uid),此处继续以增量 fetch 重新分配
  if (opts.uidValidity != null) {
    checkUidValidity(db, { accountId, folder, uidValidity: opts.uidValidity })
  }

  // 2. 取高水位,fetch uidRange: [last+1, *](仅新邮件;null 上界 = 到最大)
  const last = lastUidHighWater(db, { accountId, folder })
  const since = last != null ? last + 1 : 1
  const raws = await adapter.fetch({ folder, uidRange: [since, null as unknown as number] })

  // 3. 入库 + 更新高水位 + 发事件
  let maxUid = last ?? 0
  let inserted = 0
  for (const raw of raws) {
    if (raw.imapUid == null) continue
    upsertMessage(db, {
      messageId: raw.messageId,
      subject: raw.subject ?? null,
      from: raw.from ?? null,
      to: raw.to ?? null,
      cc: raw.cc ?? null,
      bcc: raw.bcc ?? null,
      body: raw.body ?? null,
      bodyHtml: raw.bodyHtml ?? null,
      receivedAt: raw.receivedAt ?? null,
      accountId,
      folder,
      imapUid: raw.imapUid,
    })
    maxUid = Math.max(maxUid, raw.imapUid)
    inserted++
    publish({
      type: 'new-mail',
      payload: { messageId: raw.messageId, accountId, folder, subject: raw.subject ?? null, from: raw.from ?? null },
    })
  }
  if (inserted > 0) setUidHighWater(db, { accountId, folder, uid: maxUid })

  // 4. 重算未读角标 + publish
  if (inserted > 0) {
    const u = recomputeUnread(db, { accountId, folder })
    publish({ type: 'unread-count', payload: { accountId, folder, unread: u.unread, total: u.total } })
  }

  return { inserted }
}
