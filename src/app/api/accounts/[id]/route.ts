// src/app/api/accounts/[id]/route.ts — 单账号 GET/PATCH/DELETE

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/* eslint-disable @typescript-eslint/no-explicit-any */
function sanitize(row: any) {
  const { authCode, oauthRefreshToken, ...safe } = row
  return safe
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseInt((await params).id, 10)
  const db = getDb()
  const row = db.select().from(accounts).where(eq(accounts.id, id)).all()[0] as any
  if (!row) return NextResponse.json({ error: '账号不存在' }, { status: 404 })
  return NextResponse.json({ account: sanitize(row) })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseInt((await params).id, 10)
  const body = await request.json()
  const db = getDb()
  // 只允许更新安全字段（不允许直接改 authCode 之外的凭据经由无校验 set）
  const allowed: Record<string, unknown> = {}
  for (const k of [
    'displayName', 'isActive', 'syncMode', 'provider', 'protocol',
    'imapHost', 'imapPort', 'smtpHost', 'smtpPort', 'user', 'authCode',
  ]) {
    if (k in body) allowed[k] = body[k]
  }
  db.update(accounts).set(allowed).where(eq(accounts.id, id)).run()
  const row = db.select().from(accounts).where(eq(accounts.id, id)).all()[0] as any
  if (!row) return NextResponse.json({ error: '账号不存在' }, { status: 404 })
  return NextResponse.json({ account: sanitize(row) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseInt((await params).id, 10)
  const db = getDb()
  db.delete(accounts).where(eq(accounts.id, id)).run()
  return NextResponse.json({ ok: true })
}
