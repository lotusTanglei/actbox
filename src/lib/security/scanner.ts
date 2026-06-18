// src/lib/security/scanner.ts — 可插拔附件扫描钩子。plan-11 Task 6。
export interface ScanInput { filePath: string; filename: string; mimeType: string; sha256: string }
export type ScanStatus = 'clean' | 'suspicious' | 'malicious' | 'error'
export interface ScanResult { status: ScanStatus; engine: string; detail?: string }
export interface AttachmentScanner { name: string; scan(input: ScanInput): Promise<ScanResult> }

export const noopScanner: AttachmentScanner = { name: 'noop', async scan() { return { status: 'clean', engine: 'noop' } } }
const registry: AttachmentScanner[] = [noopScanner]
export function registerScanner(scanner: AttachmentScanner): void { registry.push(scanner) }
export function resetScanners(): void { registry.length = 0; registry.push(noopScanner) }
export function getScanners(): readonly AttachmentScanner[] { return registry }

const SEVERITY: Record<ScanStatus, number> = { clean: 0, suspicious: 1, error: 2, malicious: 3 }

export async function scanAttachment(input: ScanInput): Promise<ScanResult> {
  let worst: ScanResult = { status: 'clean', engine: 'none' }
  for (const s of registry) {
    try { const r = await s.scan(input); if (SEVERITY[r.status] > SEVERITY[worst.status]) worst = r; if (r.status === 'malicious') return r }
    catch { if (SEVERITY[worst.status] < SEVERITY['error']) worst = { status: 'error', engine: s.name, detail: 'scanner threw' } }
  }
  return worst
}
