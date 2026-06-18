// src/lib/contacts/import-export.ts
// vCard 3.0 / CSV 解析与序列化（真实内联，不引重型库）。plan-09 Task 7。

export interface ContactDto { name: string; email: string; phone?: string; note?: string }

/* ---------- vCard ---------- */

export function parseVCard(raw: string): ContactDto[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
  const out: ContactDto[] = []
  let cur: Partial<ContactDto> | null = null
  for (const line of lines) {
    const up = line.toUpperCase()
    if (up === 'BEGIN:VCARD') { cur = { name: '', email: '' }; continue }
    if (up === 'END:VCARD') {
      if (cur && cur.email) out.push({ name: cur.name || '', email: cur.email.toLowerCase(), phone: cur.phone, note: cur.note })
      cur = null; continue
    }
    if (!cur) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const kRaw = line.slice(0, colonIdx)
    const value = line.slice(colonIdx + 1)
    const key = kRaw.split(';')[0].toUpperCase()
    if (key === 'FN') cur.name = value
    else if (key === 'N') { const parts = value.split(';'); cur.name = cur.name || (parts[1] + ' ' + parts[0]).trim() }
    else if (key === 'EMAIL') cur.email = value.trim().toLowerCase()
    else if (key === 'TEL') cur.phone = value
    else if (key === 'NOTE') cur.note = value
  }
  return out
}

export function toVCard(rows: ContactDto[]): string {
  const esc = (s: string) => s.replace(/\\n/g, ' ').replace(/\r?\n/g, ' ')
  return rows.map(r => {
    const parts = r.name ? r.name.split(/\s+/) : ['', '']
    return [
      'BEGIN:VCARD', 'VERSION:3.0',
      `FN:${r.name || r.email}`,
      `N:${parts[1] || ''};${parts[0] || ''};;;`,
      r.phone ? `TEL;TYPE=CELL:${r.phone}` : null,
      `EMAIL:${r.email}`,
      r.note ? `NOTE:${esc(r.note)}` : null,
      'END:VCARD',
    ].filter(Boolean).join('\n')
  }).join('\n')
}

/* ---------- CSV ---------- */

export function parseCsv(raw: string): ContactDto[] {
  const rows = csvParse(raw)
  if (rows.length < 2) return []
  const header = rows[0].map((h: string) => h.trim().toLowerCase())
  const ni = header.indexOf('name'), ei = header.indexOf('email'), pi = header.indexOf('phone'), oi = header.indexOf('note')
  if (ei < 0) return []
  return rows.slice(1)
    .filter((r: string[]) => r[ei] && r[ei].trim())
    .map((r: string[]) => ({
      name: ni >= 0 ? (r[ni] || '').trim() : '',
      email: (r[ei] || '').toLowerCase().trim(),
      phone: pi >= 0 ? (r[pi] || '').trim() : '',
      note: oi >= 0 ? (r[oi] || '').trim() : '',
    }))
}

export function toCsv(rows: ContactDto[]): string {
  const csvCell = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  const header = 'name,email,phone,note'
  const body = rows.map(r => [r.name || '', r.email || '', r.phone || '', r.note || ''].map(csvCell).join(','))
  return [header, ...body].join('\n')
}

function csvParse(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inQuotes) {
      if (c === '"') { if (raw[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && raw[i + 1] === '\n') i++
        row.push(field); rows.push(row); row = []; field = ''
      } else field += c
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length && r.some(c => c.trim() !== ''))
}
