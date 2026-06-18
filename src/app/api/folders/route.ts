// src/app/api/folders/route.ts — 文件夹列表 + 触发同步

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { listFoldersByAccount } from '@/lib/folders/repo'
import { syncFolders } from '@/lib/folders/sync'
import { getAdapter, listActiveAccountIds } from '@/lib/adapter/mail/adapterRegistry'

/** GET /api/folders?accountId=1 — 按账号列出;省略则聚合所有启用账号 */
export async function GET(req: NextRequest) {
  const raw = getRawDb()
  const accountId = req.nextUrl.searchParams.get('accountId')
  if (accountId) {
    return NextResponse.json({ folders: listFoldersByAccount(raw, parseInt(accountId, 10)) })
  }
  const ids = listActiveAccountIds()
  const folders = ids.flatMap((id) => listFoldersByAccount(raw, id))
  return NextResponse.json({ folders })
}

/** POST /api/folders — body {accountId} 触发该账号文件夹同步,返回同步数量 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const accountId = Number(body?.accountId)
    if (!accountId) return NextResponse.json({ error: '缺少 accountId' }, { status: 400 })
    const adapter = getAdapter(accountId)
    if (!adapter) return NextResponse.json({ error: '账号不存在' }, { status: 404 })
    const synced = await syncFolders(getRawDb(), { accountId, adapter })
    return NextResponse.json({ synced })
  } catch (error) {
    console.error('[/api/folders POST] Error:', error)
    return NextResponse.json({ error: '同步失败' }, { status: 500 })
  }
}
