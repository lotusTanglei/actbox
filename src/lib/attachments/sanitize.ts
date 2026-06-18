// src/lib/attachments/sanitize.ts
// 附件安全：filename 清洗（防路径穿越/控制字符）+ 大小上限 + ZIP 炸弹预检。plan-04 Task 2。

/** 单附件 / 单邮件大小上限（字节）。默认 25MB / 50MB，可由调用方覆盖。 */
export interface SizeLimits {
  perAttachment: number
  perMessage: number
}

export const DEFAULT_LIMITS: SizeLimits = {
  perAttachment: 25 * 1024 * 1024,
  perMessage: 50 * 1024 * 1024,
}

/**
 * 清洗附件文件名：剥离路径穿越（../ 与绝对路径，含 Windows 反斜杠）、
 * 去控制字符，空名兜底为 'attachment'。保留正常多语言名。
 *
 * 用纯字符串处理（先把 \ 归一为 / 再取末段），避免 path.basename 在不同平台
 * 分隔规则不一致放过反斜杠路径。
 */
export function sanitizeFilename(name: string): string {
  const normalized = (name ?? '').replace(/\\/g, '/')
  let base = normalized.split('/').pop() ?? ''
  base = base.replace(/[\x00-\x1f]/g, '') // 控制字符
  base = base.trim()
  return base || 'attachment'
}

/** 单附件大小是否在限制内（同时受 perAttachment 与 perMessage 约束）。 */
export function isWithinSizeLimit(size: number, limits: SizeLimits): boolean {
  return size <= limits.perAttachment && size <= limits.perMessage
}

/** ZIP 炸弹预检：解压前若压缩比 > 100 视为风险。compressedSize<=0 不误报。 */
export function isZipBombRisk(opts: { compressedSize: number; uncompressedSize: number }): boolean {
  if (opts.compressedSize <= 0) return false
  return opts.uncompressedSize / opts.compressedSize > 100
}
