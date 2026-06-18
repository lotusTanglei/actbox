// src/lib/db/settings.ts
// settings 表 KV 读写(raw better-sqlite3)。plan-07 Task 7(Saved Search/历史复用)。

import type Database from 'better-sqlite3'

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function getSettingJSON<T>(db: Database.Database, key: string, fallback: T): T {
  const raw = getSetting(db, key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setSettingJSON(db: Database.Database, key: string, value: unknown): void {
  setSetting(db, key, JSON.stringify(value))
}
