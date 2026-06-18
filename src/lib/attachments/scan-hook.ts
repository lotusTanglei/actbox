// src/lib/attachments/scan-hook.ts
// 病毒扫描钩子(默认 no-op)。真实实现(ClamAV/本地签名)由子项目 11 安全落地。
// 采用裸函数形态(而非对象),贴合调用方直接 scan(buf, meta);plan-04 Task 4。

export interface ScanResult {
  ok: boolean
  /** 命中原因(如病毒名/签名),ok=false 时填写 */
  reason?: string
}

export type ScanMeta = { filename: string; mimeType: string | null }

/**
 * 扫描附件内容。
 * @returns ok=true 放行;ok=false 标记 flagged(不阻断入库,仅标记)
 */
export type ScanHook = (buf: Buffer, meta: ScanMeta) => Promise<ScanResult>

/** 默认无操作钩子:全部放行。 */
export const NOOP_SCAN: ScanHook = async () => ({ ok: true })
