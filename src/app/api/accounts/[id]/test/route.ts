// src/app/api/accounts/[id]/test/route.ts — 测试账号连接

import { NextRequest, NextResponse } from 'next/server'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'

/** POST /api/accounts/[id]/test — 测试 IMAP 连接 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseInt((await params).id, 10)
  const adapter = getAdapter(id)
  if (!adapter) return NextResponse.json({ error: '账号不存在' }, { status: 404 })
  const result = await adapter.testConnection()
  return NextResponse.json(result)
}
