// src/app/api/accounts/route.ts — 账号列表 + 创建

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { getPreset } from '@/lib/adapter/mail/presets'

/* eslint-disable @typescript-eslint/no-explicit-any */
function sanitize(row: any) {
  const { authCode, oauthRefreshToken, ...safe } = row
  return safe
}

/** GET /api/accounts — 列出所有账号（不含凭据） */
export async function GET() {
  const db = getDb()
  const rows = db.select().from(accounts).all() as any[]
  return NextResponse.json({ accounts: rows.map(sanitize) })
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
