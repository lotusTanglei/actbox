// src/lib/search/history.ts
// 搜索历史(settings KV,最近 50 条,同 query 仅留最新)。plan-07 Task 7。

import type Database from 'better-sqlite3'
import { getSettingJSON, setSettingJSON } from '@/lib/db/settings'

export interface HistoryEntry {
  id: string
  query: string
  at: number
}

const KEY = 'search_history'
const MAX = 50

/** 记录一条搜索历史(同 query 去重,仅留最新;截断到最近 MAX 条)。返回 query(供测试断言)。 */
export function recordSearchHistory(db: Database.Database, query: string): string {
  const q = (query || '').trim()
  if (!q) return q
  const list = getSettingJSON<HistoryEntry[]>(db, KEY, []).filter((h) => h.query !== q)
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, query: q, at: Date.now() })
  setSettingJSON(db, KEY, list.slice(0, MAX))
  return q
}

export function listSearchHistory(db: Database.Database): HistoryEntry[] {
  return getSettingJSON<HistoryEntry[]>(db, KEY, [])
}

export function clearSearchHistory(db: Database.Database): void {
  setSettingJSON(db, KEY, [])
}
