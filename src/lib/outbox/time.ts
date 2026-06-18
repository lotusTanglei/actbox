// src/lib/outbox/time.ts — 时区纯函数(UTC 存/本地显)。plan-13 Task 3。
export function nowUtcMs(): number { return Date.now() }

export function systemTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** UTC ms → 指定 tz 的 {date, time, label} wall-clock(仅显示用)。 */
export function toLocalDisplay(
  utcMs: number,
  tz: string = systemTimezone(),
): { date: string; time: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const time = `${get('hour')}:${get('minute')}`
  return { date, time, label: `${date} ${time}` }
}

/** 本地 wall-clock {date,time} → UTC ms。把指定 tz 的 wall-clock 当作该 tz 的本地时间换算 epoch。 */
export function parseLocalToUtc(
  input: { date: string; time: string },
  tz: string = systemTimezone(),
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date)
  if (!m) throw new Error(`invalid date: ${input.date} (expect YYYY-MM-DD)`)
  const tm = /^(\d{2}):(\d{2})$/.exec(input.time)
  if (!tm) throw new Error(`invalid time: ${input.time} (expect HH:MM)`)
  const [, y, mo, d] = m; const [, h, mi] = tm
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, 0)
  const offsetMin = tzOffsetMinutes(asUtc, tz)
  return asUtc - offsetMin * 60_000
}

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const tzWall = new Date(utcMs).toLocaleString('en-US', { timeZone: tz })
  const tzAsEpoch = Date.parse(tzWall)
  const utcWall = new Date(utcMs).toLocaleString('en-US', { timeZone: 'UTC' })
  const utcAsEpoch = Date.parse(utcWall)
  return Math.round((tzAsEpoch - utcAsEpoch) / 60_000)
}
