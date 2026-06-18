// src/lib/sync/writeback.ts
// 本地动作(markRead/star/move/archive/restore/delete)→ 乐观更新 messages +
// 经 MailAdapter 用 UID 回写服务器。幂等(已在目标态则跳过回写);
// 任一 adapter 调用失败 → 回滚本次全部乐观更新并 throw(上层落 jobs 重试)。
// 注:`star` 暂为本地 only(MailAdapter 无 flag 接口,\Flagged 回写为后续增强)。

import type Database from 'better-sqlite3'
import type { MailAdapter } from '@/lib/adapter/types'

export type WritebackAction = 'markRead' | 'star' | 'move' | 'archive' | 'restore' | 'delete'

export interface ApplyActionOpts {
  adapter: MailAdapter
  action: WritebackAction
  messageIds: number[]
  value?: boolean
  targetFolder?: string
}

interface MsgRow {
  id: number
  account_id: number
  folder: string
  imap_uid: number | null
  is_read: number
  is_starred: number
  is_deleted: number
  is_archived: number
  archived_at: number | null
}

/** 从 folders 表找归档文件夹路径,缺省 'Archive' */
function resolveArchivePath(db: Database.Database, accountId: number): string {
  const row = db
    .prepare("SELECT path FROM folders WHERE account_id = ? AND type = 'archive' LIMIT 1")
    .get(accountId) as { path: string } | undefined
  return row?.path ?? 'Archive'
}

export async function applyAction(db: Database.Database, opts: ApplyActionOpts): Promise<void> {
  const { adapter, action, messageIds, value, targetFolder } = opts
  if (!messageIds?.length) return

  const placeholders = messageIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, account_id, folder, imap_uid, is_read, is_starred, is_deleted, is_archived, archived_at
       FROM messages WHERE id IN (${placeholders})`,
    )
    .all(...messageIds) as MsgRow[]

  const nowSec = Math.floor(Date.now() / 1000)
  type Plan = { row: MsgRow; sets: Record<string, number | string> }
  const plans: Plan[] = []
  const calls: Array<() => Promise<void>> = []

  for (const row of rows) {
    const o = row
    const sets: Record<string, number | string> = {}
    const addCall = (fn: () => Promise<void>) => {
      if (o.imap_uid != null) calls.push(fn)
    }

    switch (action) {
      case 'markRead':
        if (!!o.is_read === !!value) continue // 幂等
        sets.is_read = value ? 1 : 0
        addCall(() => adapter.markRead(o.imap_uid!, o.folder, !!value))
        break
      case 'star':
        if (!!o.is_starred === !!value) continue
        sets.is_starred = value ? 1 : 0
        break // 本地 only
      case 'move': {
        const tgt = targetFolder
        if (!tgt) throw new Error('move 需要 targetFolder')
        if (o.folder === tgt) continue
        sets.folder = tgt
        addCall(() => adapter.move(o.imap_uid!, o.folder, tgt))
        break
      }
      case 'archive': {
        if (o.is_archived) continue
        const tgt = resolveArchivePath(db, o.account_id)
        sets.is_archived = 1
        sets.archived_at = nowSec
        if (o.folder !== tgt) sets.folder = tgt
        addCall(() => adapter.move(o.imap_uid!, o.folder, tgt))
        break
      }
      case 'restore': {
        if (!o.is_deleted && !o.is_archived && o.folder === 'INBOX') continue
        const from = o.folder
        sets.is_deleted = 0
        sets.is_archived = 0
        sets.folder = 'INBOX'
        addCall(() => adapter.move(o.imap_uid!, from, 'INBOX'))
        break
      }
      case 'delete':
        if (o.is_deleted) continue
        sets.is_deleted = 1
        addCall(() => adapter.delete(o.imap_uid!, o.folder))
        break
      default:
        throw new Error(`未知 action: ${String(action)}`)
    }

    plans.push({ row: o, sets })
  }

  if (plans.length === 0) return

  // 1. 乐观更新(事务)
  applySets(db, plans)

  // 2. 回写服务器;失败则回滚并抛出
  try {
    for (const call of calls) await call()
  } catch (e) {
    revertSets(db, plans)
    throw e
  }
}

function applySets(db: Database.Database, plans: { row: MsgRow; sets: Record<string, number | string> }[]): void {
  const tx = db.transaction(() => {
    for (const p of plans) {
      const cols = Object.keys(p.sets)
      if (cols.length === 0) continue
      const setClause = cols.map((c) => `${c} = ?`).join(', ')
      const params = cols.map((c) => p.sets[c])
      db.prepare(`UPDATE messages SET ${setClause} WHERE id = ?`).run(...params, p.row.id)
    }
  })
  tx()
}

/** 回滚:把本批改过的字段恢复为旧值 */
function revertSets(db: Database.Database, plans: { row: MsgRow }[]): void {
  const tx = db.transaction(() => {
    for (const p of plans) {
      const o = p.row
      db.prepare(
        'UPDATE messages SET is_read = ?, is_starred = ?, is_deleted = ?, is_archived = ?, archived_at = ?, folder = ? WHERE id = ?',
      ).run(o.is_read, o.is_starred, o.is_deleted, o.is_archived, o.archived_at, o.folder, o.id)
    }
  })
  tx()
}
