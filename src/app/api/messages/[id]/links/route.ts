// src/app/api/messages/[id]/links/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getRawDb } from '@/lib/db'
import { extractLinks, isPhishing } from '@/lib/security/auth-headers'
import { sanitizeEmailHtml } from '@/lib/security/sanitize'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const m = getRawDb().prepare('SELECT body_html FROM messages WHERE id = ?').get(Number(id)) as any
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const html = sanitizeEmailHtml(m.body_html || '')
  const links = extractLinks(html)
  const warnings = isPhishing(links)
  return NextResponse.json({ links, warnings })
}
