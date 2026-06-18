// src/app/api/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { createRule, listRules, reorderRules } from '@/lib/rules/repo'

export async function GET(req: NextRequest) {
  const accountId = Number(new URL(req.url).searchParams.get('accountId'))
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  return NextResponse.json({ rules: listRules(getRawDb(), accountId) })
}

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.accountId || !b.name || !b.conditions || !b.actions)
    return NextResponse.json({ error: 'accountId, name, conditions, actions required' }, { status: 400 })
  const id = createRule(getRawDb(), { accountId: b.accountId, name: b.name, conditions: b.conditions, actions: b.actions, order: b.order ?? 0, kind: b.kind ?? 'normal', enabled: b.enabled !== false })
  return NextResponse.json({ rule: { id, ...b } }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const b = await req.json()
  if (!b.accountId || !Array.isArray(b.orderedIds)) return NextResponse.json({ error: 'accountId + orderedIds required' }, { status: 400 })
  reorderRules(getRawDb(), b.orderedIds.map((id: number, i: number) => ({ id, order: i })))
  return NextResponse.json({ ok: true })
}
