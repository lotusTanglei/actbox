// src/app/api/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { getRule, updateRule, setEnabled, deleteRule } from '@/lib/rules/repo'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json({ rule: getRule(getRawDb(), Number(id)) })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json()
  const db = getRawDb()
  if (b.enabled !== undefined) setEnabled(db, Number(id), !!b.enabled)
  const patch: any = {}
  if (b.name !== undefined) patch.name = b.name
  if (b.conditions !== undefined) patch.conditions = b.conditions
  if (b.actions !== undefined) patch.actions = b.actions
  if (b.kind !== undefined) patch.kind = b.kind
  if (Object.keys(patch).length) updateRule(db, Number(id), patch)
  return NextResponse.json({ rule: getRule(db, Number(id)) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteRule(getRawDb(), Number(id))
  return NextResponse.json({ ok: true })
}
