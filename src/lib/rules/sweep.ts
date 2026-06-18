// src/lib/rules/sweep.ts — Inbox Sweep 批量归档。plan-10 Task 7。
export interface SweepResult { keptMessageId: number | null; archivedIds: number[]; archivedCount: number }

export async function inboxSweep(db: any, args: { accountId: number; fromEmail: string; keep?: number; applyAction: (db: any, opts: any) => Promise<void> }): Promise<SweepResult> {
  const keep = args.keep ?? 1
  const email = args.fromEmail.toLowerCase().trim()
  const rows = db.prepare(`SELECT id FROM messages WHERE account_id = ? AND folder = 'INBOX' AND is_archived = 0 AND is_deleted = 0 AND lower(sender) LIKE ? ORDER BY received_at DESC`).all(args.accountId, `%${email}%`) as { id: number }[]
  if (rows.length <= keep) return { keptMessageId: rows[0]?.id ?? null, archivedIds: [], archivedCount: 0 }
  const kept = rows[0].id
  const toArchive = rows.slice(keep).map(r => r.id).sort((a, b) => a - b)
  if (toArchive.length) await args.applyAction(db, { action: 'archive', messageIds: toArchive })
  return { keptMessageId: kept, archivedIds: toArchive, archivedCount: toArchive.length }
}
