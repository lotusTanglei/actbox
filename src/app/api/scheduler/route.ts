// src/app/api/scheduler/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { startScheduler, stopScheduler, isSchedulerRunning } from '@/lib/scheduler'

/** GET /api/scheduler — 获取调度状态 */
export async function GET() {
  return NextResponse.json({
    running: isSchedulerRunning(),
  })
}

/** POST /api/scheduler — 启动/停止调度 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, cronExpression } = body

    if (action === 'start') {
      startScheduler(cronExpression || '*/30 * * * *')
      return NextResponse.json({ running: true, message: '定时拉取已启动' })
    }

    if (action === 'stop') {
      stopScheduler()
      return NextResponse.json({ running: false, message: '定时拉取已停止' })
    }

    return NextResponse.json({ error: 'Invalid action. Use start/stop' }, { status: 400 })
  } catch (error) {
    console.error('[/api/scheduler] Error:', error)
    return NextResponse.json({ error: 'Failed to update scheduler' }, { status: 500 })
  }
}
