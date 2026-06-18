// src/lib/calendar/grid.ts — 日历网格纯函数。plan-16 Task 3。
export interface CalendarDay {
  date: string       // YYYY-MM-DD
  day: number
  isCurrentMonth: boolean
  isToday: boolean
}

export interface EventRecord {
  id: number
  title: string
  startsAt: number   // UTC ms
  endsAt: number | null
  allDay: number | boolean
}

/** 生成月网格(6×7) */
export function buildMonthGrid(year: number, month: number, weekStartsOn: number = 1): CalendarDay[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  // 月第一天所在周的起始日
  const startDow = (firstDay.getUTCDay() + 7 - weekStartsOn) % 7
  const start = new Date(firstDay)
  start.setUTCDate(start.getUTCDate() - startDow)
  const today = new Date().toISOString().slice(0, 10)
  const days: CalendarDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    const ds = d.toISOString().slice(0, 10)
    days.push({
      date: ds,
      day: d.getUTCDate(),
      isCurrentMonth: d.getUTCMonth() + 1 === month && d.getUTCFullYear() === year,
      isToday: ds === today,
    })
  }
  return days
}

/** 按区间筛选事件 */
export function eventsInInterval(events: EventRecord[], fromMs: number, toMs: number): EventRecord[] {
  return events.filter((e) => e.startsAt < toMs && (e.endsAt ?? e.startsAt + 3600000) > fromMs)
}

/** UTC ms → 本地日期的 YYYY-MM-DD */
export function utcToLocalDate(utcMs: number, tz: string = 'Asia/Shanghai'): string {
  return new Date(utcMs).toLocaleDateString('en-CA', { timeZone: tz })
}

/** 本地 YYYY-MM-DD 的 00:00 → UTC ms */
export function localDateToUtc(dateStr: string, tz: string = 'Asia/Shanghai'): number {
  const d = new Date(dateStr + 'T00:00:00')
  const tzWall = d.toLocaleString('en-US', { timeZone: tz })
  return Date.parse(tzWall)
}
