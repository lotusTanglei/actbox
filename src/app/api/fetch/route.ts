// src/app/api/fetch/route.ts — 拉取邮件(多账号同步引擎驱动)

import { NextResponse } from 'next/server'
import { syncActiveAccounts } from '@/lib/sync/syncEngine'

/** POST /api/fetch — 同步所有启用账号的新邮件并抽取待办 */
export async function POST() {
  try {
    const summary = await syncActiveAccounts()

    if (summary.totalFetched === 0) {
      return NextResponse.json({
        fetched: 0,
        newTodos: 0,
        results: summary.results,
        accountErrors: summary.accountErrors,
        message: '没有新邮件',
      })
    }

    return NextResponse.json({
      fetched: summary.totalFetched,
      newTodos: summary.totalNewTodos,
      results: summary.results,
      accountErrors: summary.accountErrors,
    })
  } catch (error) {
    console.error('[/api/fetch] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'

    if (
      message.includes('IMAP') ||
      message.includes('ECONNREFUSED') ||
      message.includes('auth') ||
      message.includes('login')
    ) {
      return NextResponse.json({ error: `邮箱连接失败: ${message}` }, { status: 503 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
