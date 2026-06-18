// src/app/api/contacts/groups/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { createGroup, listGroups } from '@/lib/contacts/repo'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const accountId = Number(searchParams.get('accountId') || 1)
  const db = getRawDb()
  const groups = listGroups(db, accountId)
  const withCount = groups.map(g => {
    const { c } = db.prepare('SELECT count(*) c FROM contacts WHERE group_id = ?').get(g.id) as { c: number }
    return { ...g, memberCount: c }
  })
  return NextResponse.json({ groups: withCount })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { accountId, name } = body
  if (!name) return NextResponse.json({ error: 'name 必填' }, { status: 400 })
  const db = getRawDb()
  const existing = db.prepare('SELECT id FROM contacts_groups WHERE account_id=? AND name=?').get(accountId||1, name) as any
  const g = createGroup(db, { accountId: accountId || 1, name })
  return NextResponse.json({ group: g }, { status: existing ? 200 : 201 })
}
