// src/app/api/contacts/export/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { listContacts } from '@/lib/contacts/repo'
import { toVCard, toCsv } from '@/lib/contacts/import-export'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = Number(searchParams.get('accountId') || 1)
    const format = searchParams.get('format') || 'vcard'
    const db = getRawDb()
    const contacts = listContacts(db, accountId)
    const rows = contacts.map(c => ({ name: c.name, email: c.email, phone: c.phone || '', note: c.note || '' }))

    if (format === 'csv') {
      return new NextResponse(toCsv(rows), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=contacts.csv' },
      })
    }
    return new NextResponse(toVCard(rows), {
      headers: { 'Content-Type': 'text/vcard', 'Content-Disposition': 'attachment; filename=contacts.vcf' },
    })
  } catch { return NextResponse.json({ error: '导出失败' }, { status: 500 }) }
}
