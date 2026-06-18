// src/app/api/contacts/import/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { upsertByEmail } from '@/lib/contacts/repo'
import { parseVCard, parseCsv, type ContactDto } from '@/lib/contacts/import-export'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { accountId, format, data } = body
    if (!data || !format) return NextResponse.json({ error: 'data + format 必填' }, { status: 400 })

    let rows: ContactDto[]
    if (format === 'vcard') rows = parseVCard(data)
    else if (format === 'csv') rows = parseCsv(data)
    else return NextResponse.json({ error: 'format 仅支持 vcard|csv' }, { status: 400 })

    const db = getRawDb()
    let imported = 0, skipped = 0
    for (const r of rows) {
      if (!r.email) continue
      const result = upsertByEmail(db, { accountId: accountId || 1, email: r.email, name: r.name })
      if (result.created) imported++
      else skipped++
    }
    return NextResponse.json({ imported, skipped })
  } catch { return NextResponse.json({ error: '导入失败' }, { status: 500 }) }
}
