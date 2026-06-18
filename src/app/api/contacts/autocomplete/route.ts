// src/app/api/contacts/autocomplete/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { autocomplete } from '@/lib/contacts/autocomplete'

/** GET /api/contacts/autocomplete?q=&accountId= */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') ?? ''
    const accountId = Number(searchParams.get('accountId') || 1)
    const db = getRawDb()
    const hits = autocomplete(db, { accountId, q, limit: 8 })
    return NextResponse.json({ hits })
  } catch (error) {
    console.error('[/api/contacts/autocomplete] Error:', error)
    return NextResponse.json({ error: 'Autocomplete failed' }, { status: 500 })
  }
}
