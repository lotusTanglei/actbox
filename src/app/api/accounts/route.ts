// src/app/api/accounts/route.ts — 账号列表 + 创建

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { accounts, messages } from '@/lib/db/schema'
import { getPreset } from '@/lib/adapter/mail/presets'
import { and, count, eq } from 'drizzle-orm'

/* eslint-disable @typescript-eslint/no-explicit-any */
function sanitize(row: any) {
  const { authCode, oauthRefreshToken, ...safe } = row
  return safe
}

/** GET /api/accounts — 列出所有账号(不含凭据)+ 每账号未读数 */
export async function GET() {
  const db = getDb()
  const rows = db.select().from(accounts).all() as any[]

  // 按账号聚合未读(收件 + 未删)
  const unreadRows = db
    .select({ accountId: messages.accountId, n: count() })
    .from(messages)
    .where(and(eq(messages.isRead, false), eq(messages.direction, 'in'), eq(messages.isDeleted, false)))
    .groupBy(messages.accountId)
    .all() as { accountId: number; n: number }[]
  const unreadMap: Record<number, number> = {}
  for (const r of unreadRows) unreadMap[r.accountId] = r.n

  const out = rows.map((r) => ({ ...sanitize(r), unreadCount: unreadMap[r.id] || 0 }))
  return NextResponse.json({ accounts: out })
}

/** POST /api/accounts — 新增账号（provider 有 preset 时自动填 host/port） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, provider, user, authCode, displayName, protocol } = body
    if (!email || !provider || !user || !authCode) {
      return NextResponse.json({ error: '缺少 email/provider/user/authCode' }, { status: 400 })
    }
    const preset = getPreset(provider)
    const db = getDb()
    const result = db
      .insert(accounts)
      .values({
        email,
        provider,
        user,
        authCode,
        displayName,
        protocol: protocol || 'imap',
        imapHost: body.imapHost || preset?.imapHost || null,
        imapPort: body.imapPort || preset?.imapPort || null,
        smtpHost: body.smtpHost || preset?.smtpHost || null,
        smtpPort: body.smtpPort || preset?.smtpPort || null,
      })
      .returning()
      .all()
    return NextResponse.json({ account: sanitize(result[0]) }, { status: 201 })
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: '该邮箱已存在' }, { status: 409 })
    }
    console.error('[/api/accounts POST] Error:', error)
    return NextResponse.json({ error: '创建失败' }, { status: 500 })
  }
}
