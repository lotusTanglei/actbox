// src/lib/messages/cursor.ts — 游标分页编解码纯函数。plan-14 Task 1。
export const DEFAULT_LIMIT = 50
export const MIN_LIMIT = 10
export const MAX_LIMIT = 200

/** (received_at[epoch秒], id) → base64url 游标 token */
export function encodeCursor(receivedAt: number, id: number): string {
  return Buffer.from(`${receivedAt}.${id}`, 'utf8').toString('base64url')
}

/** 解码游标 token。非法返回 null(调用方按"无游标=首页"处理) */
export function decodeCursor(token: string | null | undefined): { receivedAt: number; id: number } | null {
  if (!token) return null
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const m = /^(\d+)\.(\d+)$/.exec(decoded)
    if (!m) return null
    return { receivedAt: Number(m[1]), id: Number(m[2]) }
  } catch {
    return null
  }
}

/** limit clamp 到 [MIN, MAX],默认 50 */
export function clampLimit(raw: number | undefined): number {
  if (raw == null || Number.isNaN(raw)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(raw)))
}
