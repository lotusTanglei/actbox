// src/lib/labels/apply.ts
// 批量贴/撕标签（事务内逐对操作）。plan-08 Task 5。

import type Database from 'better-sqlite3'
import { attachLabels, detachLabel } from '@/lib/labels/repo'

export interface ApplyLabelsInput {
  messageIds: number[]
  labelIds: number[]
  mode: 'attach' | 'detach'
}

export interface ApplyLabelsResult {
  affected: number
}

/** 批量贴或撕标签，返回实际影响的关联行数 */
export function applyLabels(db: Database.Database, input: ApplyLabelsInput): ApplyLabelsResult {
  let affected = 0
  const tx = db.transaction(() => {
    if (input.mode === 'attach') {
      for (const mid of input.messageIds) {
        for (const lid of input.labelIds) {
          // INSERT OR IGNORE: 记录 changes 判断是否新增
          const info = db.prepare(
            'INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?, ?)',
          ).run(mid, lid)
          affected += info.changes
        }
      }
    } else {
      for (const mid of input.messageIds) {
        for (const lid of input.labelIds) {
          const info = db.prepare(
            'DELETE FROM message_labels WHERE message_id = ? AND label_id = ?',
          ).run(mid, lid)
          affected += info.changes
        }
      }
    }
  })
  tx()
  return { affected }
}
