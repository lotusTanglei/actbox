// src/app/api/settings/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/** GET /api/settings — 获取所有配置 */
export async function GET() {
  try {
    const db = getDb()
    const result = db.select().from(settings).all()

    // 转成 key-value 对象
    const config: Record<string, string> = {}
    for (const row of result) {
      config[row.key] = row.value
    }

    return NextResponse.json({ settings: config })
  } catch (error) {
    console.error('[/api/settings GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

/** PATCH /api/settings — 批量更新配置 */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb()
    const body = await request.json()

    // body 是 { key: value } 对象
    for (const [key, value] of Object.entries(body)) {
      if (typeof key !== 'string' || typeof value !== 'string') continue

      // Upsert
      const existing = db.select().from(settings).where(eq(settings.key, key)).all()
      if (existing.length > 0) {
        db.update(settings).set({ value }).where(eq(settings.key, key)).run()
      } else {
        db.insert(settings).values({ key, value }).run()
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[/api/settings PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
