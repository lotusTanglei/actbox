// src/lib/folders/repo.ts
// folders 表读写(raw better-sqlite3):upsert(ON CONFLICT 幂等)/按账号或类型列出。

import type Database from 'better-sqlite3'
import type { FolderType } from './classify'

export interface FolderRow {
  accountId: number
  path: string
  displayName: string
  type: FolderType
  unreadCount?: number
  totalCount?: number
}

/** 幂等 upsert(按 account_id+path 唯一) */
export function upsertFolder(db: Database.Database, f: FolderRow): void {
  db.prepare(
    `INSERT INTO folders (account_id, path, display_name, type, unread_count, total_count)
     VALUES (@accountId, @path, @displayName, @type, @unreadCount, @totalCount)
     ON CONFLICT(account_id, path) DO UPDATE SET
       display_name = excluded.display_name,
       type         = excluded.type,
       unread_count = excluded.unread_count,
       total_count  = excluded.total_count`,
  ).run({
    accountId: f.accountId,
    path: f.path,
    displayName: f.displayName,
    type: f.type,
    unreadCount: f.unreadCount ?? 0,
    totalCount: f.totalCount ?? 0,
  })
}

/** 列出某账号全部文件夹(按 type/display_name 排序) */
export function listFoldersByAccount(db: Database.Database, accountId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY type, display_name')
    .all(accountId) as Record<string, unknown>[]
}

/** 按类型列出(可指定账号或 'all' 聚合) */
export function listFoldersByType(
  db: Database.Database,
  accountId: number | 'all',
  type: FolderType,
): Record<string, unknown>[] {
  if (accountId === 'all') {
    return db
      .prepare('SELECT * FROM folders WHERE type = ? ORDER BY account_id, display_name')
      .all(type) as Record<string, unknown>[]
  }
  return db
    .prepare('SELECT * FROM folders WHERE account_id = ? AND type = ? ORDER BY display_name')
    .all(accountId, type) as Record<string, unknown>[]
}
