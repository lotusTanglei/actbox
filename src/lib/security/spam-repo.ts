// src/lib/security/spam-repo.ts — 标记/取消垃圾 + 举报反馈训练。plan-11 Task 8。
function getSetting(db: any, key: string, fallback: any): any { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any; if (!r) return fallback; try { return JSON.parse(r.value) } catch { return fallback } }
function setSetting(db: any, key: string, value: any): void { const v = JSON.stringify(value); const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key); if (exists) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(v, key); else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, v) }

export async function markAsSpam(db: any, args: { messageId: number; moveToSpam: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void> }): Promise<void> {
  db.prepare('UPDATE messages SET is_spam = 1 WHERE id = ?').run(args.messageId)
  await args.moveToSpam(db, { messageIds: [args.messageId], targetFolder: 'Spam' })
}

export async function unmarkSpam(db: any, args: { messageId: number; moveToFolder: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void> }): Promise<void> {
  db.prepare('UPDATE messages SET is_spam = 0 WHERE id = ?').run(args.messageId)
  await args.moveToFolder(db, { messageIds: [args.messageId], targetFolder: 'INBOX' })
  const m = db.prepare('SELECT sender FROM messages WHERE id = ?').get(args.messageId) as any
  if (m?.sender) { const mm = String(m.sender).match(/([^\s@<>]+)@([^\s@<>]+)/); if (mm) addSpamWhitelist(db, `${mm[1]}@${mm[2]}`.toLowerCase()) }
}

export function addSpamWhitelist(db: any, email: string): void {
  const e = email.toLowerCase().trim(); const wl: string[] = getSetting(db, 'spam_whitelist', [])
  if (!wl.includes(e)) { wl.push(e); setSetting(db, 'spam_whitelist', wl) }
}

export function isWhitelistedSender(db: any, email: string): boolean {
  const wl: string[] = getSetting(db, 'spam_whitelist', []); return wl.includes(email.toLowerCase().trim())
}

export async function reportSpam(db: any, args: { messageId: number; moveToSpam: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void> }): Promise<void> {
  const m = db.prepare('SELECT sender, subject, body FROM messages WHERE id = ?').get(args.messageId) as any
  await markAsSpam(db, { messageId: args.messageId, moveToSpam: args.moveToSpam })
  if (m) {
    const text = `${m.subject || ''} ${m.body || ''}`
    const tokens = (text.match(/[一-龥]{2,}|[a-z]{4,}/gi) || []).map((t: string) => t.toLowerCase()).filter((t: string) => t.length >= 2)
    const learned: string[] = getSetting(db, 'spam_learned_words', [])
    for (const t of tokens) { if (!learned.includes(t) && learned.length < 500) learned.push(t) }
    setSetting(db, 'spam_learned_words', learned)
  }
}
