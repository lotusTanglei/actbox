// src/lib/contacts/autocomplete.ts
// 自动补全聚合：通讯录 ∪ 历史通信记录，频次 + 通讯录置顶排序。plan-09 Task 3。

import type Database from 'better-sqlite3'
import { parseAddresses } from '@/lib/contacts/parse-emails'

export interface AutocompleteHit {
  name: string
  email: string
  source: 'addressbook' | 'history' | 'both'
  weight: number
  inAddressBook: boolean
  lastContactedAt: number | null
}

export function autocomplete(db: Database.Database, opts: { accountId: number; q: string; limit?: number }): AutocompleteHit[] {
  const { accountId, q } = opts
  const limit = opts.limit ?? 8
  const like = q?.trim() ? `%${q.trim().toLowerCase()}%` : null

  // 1) 通讯录
  const abRows: any[] = like
    ? db.prepare(
        `SELECT name, email, contact_count AS contactCount, last_contacted_at AS lastContactedAt
         FROM contacts WHERE account_id = ?
         AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)
         ORDER BY contact_count DESC, last_contacted_at DESC`,
      ).all(accountId, like, like)
    : db.prepare(
        `SELECT name, email, contact_count AS contactCount, last_contacted_at AS lastContactedAt
         FROM contacts WHERE account_id = ?
         ORDER BY contact_count DESC, last_contacted_at DESC`,
      ).all(accountId)

  const abMap = new Map<string, { name: string; email: string; count: number; lastContactedAt: number | null }>()
  for (const r of abRows) {
    abMap.set(r.email.toLowerCase(), { name: r.name, email: r.email, count: r.contactCount, lastContactedAt: r.lastContactedAt })
  }

  // 2) 历史：扫 messages 的 from(sender)/to(recipient)/cc/bcc
  const msgRows = db.prepare(
    'SELECT sender, "to", cc, bcc FROM messages WHERE account_id = ?',
  ).all(accountId) as { sender: string | null; to: string | null; cc: string | null; bcc: string | null }[]

  const hist = new Map<string, { name: string; freq: number }>()
  for (const row of msgRows) {
    const addrs = [
      ...parseAddresses(row.sender),
      ...parseAddresses(row.to),
      ...parseAddresses(row.cc),
      ...parseAddresses(row.bcc),
    ]
    for (const a of addrs) {
      const e = a.email.toLowerCase()
      if (like && !e.includes(q.trim().toLowerCase()) && !(a.name || '').toLowerCase().includes(q.trim().toLowerCase())) continue
      const cur = hist.get(e)
      if (cur) { cur.freq += 1; if (!cur.name && a.name) cur.name = a.name }
      else hist.set(e, { name: a.name, freq: 1 })
    }
  }

  // 3) 合并
  const merged = new Map<string, AutocompleteHit>()
  for (const [e, v] of abMap) {
    const h = hist.get(e)
    merged.set(e, {
      name: v.name, email: v.email,
      source: h ? 'both' : 'addressbook',
      weight: v.count + (h ? h.freq : 0),
      inAddressBook: true,
      lastContactedAt: v.lastContactedAt,
    })
  }
  for (const [e, h] of hist) {
    if (merged.has(e)) continue
    const ab = abMap.get(e)
    merged.set(e, {
      name: h.name, email: e,
      source: ab ? 'both' : 'history',
      weight: (ab ? ab.count : 0) + h.freq,
      inAddressBook: !!ab,
      lastContactedAt: ab ? ab.lastContactedAt : null,
    })
  }

  // 4) 排序
  return [...merged.values()]
    .sort((a, b) => {
      const ai = a.inAddressBook ? 0 : 1, bi = b.inAddressBook ? 0 : 1
      if (ai !== bi) return ai - bi
      if (b.weight !== a.weight) return b.weight - a.weight
      return (b.lastContactedAt || 0) - (a.lastContactedAt || 0)
    })
    .slice(0, limit)
}
