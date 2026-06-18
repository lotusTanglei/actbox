// src/app/api/rules/[id]/test/route.ts — 规则试跑（只算不执行）
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { getRule } from '@/lib/rules/repo'
import { matchConditions } from '@/lib/rules/match'
import type { ConditionGroup, RuleAction, RuleMessageContext, RuleTestHit } from '@/lib/rules/types'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json()
  const db = getRawDb()
  const limit = Math.min(b.limit ?? 200, 1000)

  let conditions: ConditionGroup; let actions: RuleAction[]; let ruleName: string; let ruleId: number | null
  if (b.conditions) {
    conditions = b.conditions; actions = b.actions ?? []; ruleName = b.name ?? '(草稿)'; ruleId = null
  } else {
    const r = getRule(db, Number(id))
    if (!r) return NextResponse.json({ error: 'rule not found' }, { status: 404 })
    conditions = r.conditions; actions = r.actions; ruleName = r.name; ruleId = r.id
  }

  const where = ['account_id = ?', "(folder = 'INBOX' OR folder IS NULL)"]
  const queryParams: any[] = [b.accountId]
  if (b.fromEmail) { where.push('lower(sender) LIKE ?'); queryParams.push(`%${String(b.fromEmail).toLowerCase()}%`) }
  const rows = db.prepare(`SELECT id, sender, "to", subject, body FROM messages WHERE ${where.join(' AND ')} ORDER BY received_at DESC LIMIT ?`).all(...queryParams, limit) as any[]

  const matched: RuleTestHit[] = []
  for (const m of rows) {
    const labelIds = (db.prepare('SELECT label_id FROM message_labels WHERE message_id = ?').all(m.id) as any[]).map((r: any) => r.label_id)
    const att = (db.prepare('SELECT count(*) c FROM attachments WHERE message_id = ?').get(m.id) as any)?.c ?? 0
    const sizeKb = att > 0 ? Math.round(((db.prepare('SELECT COALESCE(SUM(size),0) s FROM attachments WHERE message_id = ?').get(m.id) as any)?.s ?? 0) / 1024) : 0
    const ctx: RuleMessageContext = { messageId: m.id, accountId: b.accountId, from: m.sender ?? '', to: m.to ?? '', cc: '', subject: m.subject ?? '', body: m.body ?? '', hasAttachment: att > 0, sizeKb, labelIds }
    if (matchConditions(ctx, conditions)) matched.push({ messageId: m.id, ruleId: ruleId ?? 0, ruleName, matched: true, actions })
  }
  return NextResponse.json({ total: rows.length, matched })
}
