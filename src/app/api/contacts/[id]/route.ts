// src/app/api/contacts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { getContact, updateContact, deleteContact } from '@/lib/contacts/repo'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getRawDb()
  const c = getContact(db, parseInt(id))
  if (!c) return NextResponse.json({ error: '不存在' }, { status: 404 })
  const g = c.groupId ? db.prepare('SELECT name FROM contacts_groups WHERE id = ?').get(c.groupId) as any : null
  return NextResponse.json({ contact: { ...c, groupName: g?.name || null } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = getRawDb()
  const c = updateContact(db, parseInt(id), body)
  if (!c) return NextResponse.json({ error: '不存在' }, { status: 404 })
  return NextResponse.json({ contact: c })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getRawDb()
  deleteContact(db, parseInt(id))
  return new NextResponse(null, { status: 204 })
}
