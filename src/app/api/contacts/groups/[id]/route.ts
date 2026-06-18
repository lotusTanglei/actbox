// src/app/api/contacts/groups/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { deleteGroup, groupMembers } from '@/lib/contacts/repo'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name } = await req.json()
  const db = getRawDb()
  db.prepare('UPDATE contacts_groups SET name=? WHERE id=?').run(name, parseInt(id))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getRawDb()
  deleteGroup(db, parseInt(id))
  return new NextResponse(null, { status: 204 })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getRawDb()
  const members = groupMembers(db, parseInt(id))
  return NextResponse.json({ members: members.map(m => ({ name: m.name, email: m.email })) })
}
