// src/lib/folders/sync.ts
// listFolders() → folders 表 upsert + 角标汇总。
// adapter 已给非 custom 的 type 则信任,否则用 classifyFolder(path) 回退。

import type Database from 'better-sqlite3'
import type { FolderInfo, MailAdapter } from '@/lib/adapter/types'
import { classifyFolder } from './classify'
import { upsertFolder } from './repo'

/**
 * 同步某账号的服务器文件夹到本地 folders 表。
 * @returns 同步的文件夹数量
 */
export async function syncFolders(
  db: Database.Database,
  opts: { accountId: number; adapter: Pick<MailAdapter, 'listFolders'> },
): Promise<number> {
  const list: FolderInfo[] = await opts.adapter.listFolders()
  for (const f of list) {
    const type = f.type && f.type !== 'custom' ? f.type : classifyFolder(f.path, null)
    upsertFolder(db, {
      accountId: opts.accountId,
      path: f.path,
      displayName: f.displayName || f.path,
      type,
      unreadCount: f.unreadCount,
      totalCount: f.totalCount,
    })
  }
  return list.length
}
