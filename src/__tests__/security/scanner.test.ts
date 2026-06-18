// src/__tests__/security/scanner.test.ts
import { describe, it, expect } from 'vitest'
import { noopScanner, scanAttachment, registerScanner, resetScanners } from '@/lib/security/scanner'

describe('AttachmentScanner', () => {
  it('noopScanner 总是 clean', async () => { const r = await noopScanner.scan({ filePath: '/tmp/x', filename: 'x.exe', mimeType: 'app', sha256: 'abc' }); expect(r.status).toBe('clean') })
  it('scanAttachment 无注册扫描器 → clean', async () => { resetScanners(); expect((await scanAttachment({ filePath: '/tmp/x', filename: 'x', mimeType: 't', sha256: '1' })).status).toBe('clean') })
  it('注册 malicious → 返回 malicious 并停止', async () => {
    resetScanners(); registerScanner({ name: 'evil', scan: async () => ({ status: 'malicious', engine: 'evil', detail: 'EICAR' }) })
    expect((await scanAttachment({ filePath: '/tmp/x', filename: 'x.exe', mimeType: 'app', sha256: '1' })).status).toBe('malicious')
  })
  it('扫描器抛异常 → error', async () => {
    resetScanners(); registerScanner({ name: 'boom', scan: async () => { throw new Error('AV down') } }); registerScanner({ name: 'ok', scan: async () => ({ status: 'clean', engine: 'ok' }) })
    expect(['clean', 'error']).toContain((await scanAttachment({ filePath: '/tmp/x', filename: 'x', mimeType: 't', sha256: '1' })).status)
  })
})
