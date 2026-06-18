// src/lib/attachments/store.ts
// 附件内容寻址落盘：attachments/{accountId}/{messageId}/{sha256}.bin。
// 路径穿越防护(resolveSafePath/readStream)：resolved path 必须 startswith 允许目录 + sep。
// 去重在「同一消息内」(同内容 → 同路径 → 一个文件);跨消息不共享(路径含 messageId)。
// releaseByMessage 按 storage_path 物理引用计数删文件(per-message 布局下正确)。plan-04 Task 3。

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'

export interface StoreKey {
  accountId: number
  messageId: number
}

/** 附件落盘根目录(持久化,与 actbox.db 同在 data/ 下,便于备份)。storagePath 相对此根。 */
export function getAttachmentsRoot(): string {
  return path.join(process.cwd(), 'data')
}

/**
 * 构造并校验附件落盘相对路径：attachments/{accountId}/{messageId}/{sha256}.bin。
 * sha256 为外部/半外部输入,resolve 后必须落在「该消息目录」内,否则抛路径穿越。
 * 返回相对 root 的 storagePath(入库用)。
 */
export function resolveSafePath(root: string, opts: StoreKey & { sha256: string }): string {
  const { accountId, messageId, sha256 } = opts
  const rel = path.join('attachments', String(accountId), String(messageId), `${sha256}.bin`)
  const full = path.resolve(root, rel)
  const safeDir = path.resolve(root, 'attachments', String(accountId), String(messageId))
  if (!full.startsWith(safeDir + path.sep)) {
    throw new Error(`attachment path traversal detected: ${sha256}`)
  }
  return rel
}

/** 算 sha256 → 落盘(已存在则跳过写) → 返回相对 storagePath。 */
export async function storeContent(root: string, buf: Buffer, key: StoreKey): Promise<string> {
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const rel = resolveSafePath(root, { ...key, sha256: sha })
  const full = path.resolve(root, rel)
  if (!fs.existsSync(full)) {
    fs.mkdirSync(path.dirname(full), { recursive: true })
    await fs.promises.writeFile(full, buf)
  }
  return rel
}

/** 读取附件为可读流(下载/预览用)。storagePath 穿越 → 抛。 */
export function readStream(root: string, storagePath: string): fs.ReadStream {
  const full = path.resolve(root, storagePath)
  const safeRoot = path.resolve(root, 'attachments')
  if (!full.startsWith(safeRoot + path.sep)) {
    throw new Error(`attachment path traversal detected (readStream): ${storagePath}`)
  }
  return fs.createReadStream(full)
}

export interface ReleaseStats {
  released: number // 删除的 attachments 行数
  filesDeleted: number // 实际 unlink 的物理文件数
}

/**
 * 删除某消息全部附件行,并回收独占文件:
 * 按 storage_path 计数(删行后),无其他行引用 → unlink。
 * per-message 路径布局下,某消息的文件只可能被该消息的行引用,故删行后计数归零即可安全删。
 */
export async function releaseByMessage(
  db: Database.Database,
  root: string,
  messageId: number,
): Promise<ReleaseStats> {
  const rows = db
    .prepare('SELECT id, storage_path FROM attachments WHERE message_id = ?')
    .all(messageId) as { id: number; storage_path: string | null }[]
  if (!rows.length) return { released: 0, filesDeleted: 0 }

  db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId)

  const distinctPaths = Array.from(
    new Set(rows.map((r) => r.storage_path).filter((p): p is string => !!p)),
  )
  let filesDeleted = 0
  for (const p of distinctPaths) {
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE storage_path = ?').get(p) as {
      c: number
    }
    if (c === 0) {
      try {
        fs.unlinkSync(path.resolve(root, p))
        filesDeleted++
      } catch {
        /* 文件已不存在,忽略 */
      }
    }
  }
  return { released: rows.length, filesDeleted }
}
