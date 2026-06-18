// src/app/api/contacts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { createContact, listContacts } from '@/lib/contacts/repo'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const accountId = Number(searchParams.get('accountId') || 1)
    const q = searchParams.get('q') ?? undefined
    const groupId = searchParams.get('groupId') ? Number(searchParams.get('groupId')) : undefined
    const db = getRawDb()
    const contacts = listContacts(db, accountId, { q, groupId })
    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountId, name, email, phone, note, groupId } = body
    if (!accountId) return NextResponse.json({ error: 'accountId 必填' }, { status: 400 })
    if (!email || !/^[\w.+-]+@[\w.-]+$/.test(email)) return NextResponse.json({ error: 'email 非法' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'name 必填' }, { status: 400 })

    const db = getRawDb()
    const existing = db.prepare('SELECT id FROM contacts WHERE account_id = ? AND email = ?').get(accountId, email.toLowerCase().trim()) as any
    const contact = createContact(db, { accountId, name, email, phone, note, groupId })
    return NextResponse.json({ contact }, { status: existing ? 200 : 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
