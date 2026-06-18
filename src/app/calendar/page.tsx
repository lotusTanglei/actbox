// src/app/calendar/page.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { buildMonthGrid, type CalendarDay, type EventRecord } from '@/lib/calendar/grid'

const MONTH_NAMES = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']
const WEEKDAYS = ['一','二','三','四','五','六','日']

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [showEditor, setShowEditor] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', startsAt: '', endsAt: '', allDay: false, location: '', description: '', reminderMinutes: '' })

  const days = buildMonthGrid(year, month)

  const fetchEvents = useCallback(async () => {
    const from = Date.UTC(year, month - 2, 25)
    const to = Date.UTC(year, month, 7)
    const r = await fetch(`/api/calendar/events?from=${from}&to=${to}`)
    const d = await r.json()
    setEvents(d.events || [])
  }, [year, month])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const eventsByDay: Record<string, EventRecord[]> = {}
  for (const e of events) {
    const d = new Date(e.startsAt).toISOString().slice(0, 10)
    if (!eventsByDay[d]) eventsByDay[d] = []
    eventsByDay[d].push(e)
  }

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const openEditor = (date?: string, id?: number) => {
    setEditId(id ?? null)
    if (id) {
      const e = events.find(ev => ev.id === id)
      if (e) {
        setForm({
          title: e.title,
          startsAt: new Date(e.startsAt).toISOString().slice(0, 16),
          endsAt: e.endsAt ? new Date(e.endsAt).toISOString().slice(0, 16) : '',
          allDay: !!e.allDay,
          location: (e as any).location || '',
          description: (e as any).description || '',
          reminderMinutes: (e as any).reminder_minutes?.toString() || '',
        })
      }
    } else {
      setForm({ title: '', startsAt: date ? `${date}T09:00` : '', endsAt: '', allDay: false, location: '', description: '', reminderMinutes: '15' })
    }
    setShowEditor(true)
  }

  const handleSave = async () => {
    const body: any = {
      title: form.title,
      startsAt: new Date(form.startsAt).getTime(),
      endsAt: form.endsAt ? new Date(form.endsAt).getTime() : null,
      allDay: form.allDay,
      location: form.location || undefined,
      description: form.description || undefined,
      reminderMinutes: form.reminderMinutes ? Number(form.reminderMinutes) : undefined,
    }
    if (editId) {
      await fetch(`/api/calendar/events/${editId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    } else {
      await fetch('/api/calendar/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    }
    setShowEditor(false)
    fetchEvents()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('删除此日程？')) return
    await fetch(`/api/calendar/events/${id}`, { method: 'DELETE' })
    fetchEvents()
  }

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded p-1 hover:bg-accent">◀</button>
          <h2 className="text-lg font-bold min-w-[8rem] text-center">{year}年 {MONTH_NAMES[month - 1]}</h2>
          <button onClick={nextMonth} className="rounded p-1 hover:bg-accent">▶</button>
          <button onClick={() => { const n=new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()+1) }} className="rounded border px-2 py-0.5 text-xs hover:bg-accent">今天</button>
        </div>
        <button onClick={() => openEditor()} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90">+ 新建</button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((d) => <div key={d} className="border-r border-border px-2 py-1 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 flex-1" style={{ gridAutoRows: '1fr' }}>
          {days.map((d) => {
            const dayEvents = eventsByDay[d.date] || []
            return (
              <div
                key={d.date}
                onClick={() => openEditor(d.date)}
                className={`min-h-[80px] cursor-pointer border-b border-r border-border p-1 text-xs hover:bg-accent/30 ${
                  !d.isCurrentMonth ? 'bg-muted/30 text-muted-foreground' : ''
                } ${d.isToday ? 'bg-primary/5' : ''}`}
              >
                <span className={`${d.isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground' : ''}`}>
                  {d.day}
                </span>
                <div className="space-y-0.5 mt-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <div key={e.id} onClick={(ev) => { ev.stopPropagation(); openEditor(undefined, e.id) }}
                      className="truncate rounded bg-primary/20 px-1 py-0.5 text-[10px] text-primary hover:bg-primary/30">
                      {e.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} 更多</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEditor(false)}>
          <div className="w-96 rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-medium">{editId ? '编辑日程' : '新建日程'}</h3>
            <div className="space-y-2">
              <input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="标题" className="w-full rounded border px-2 py-1 text-sm" />
              <div className="flex gap-2">
                <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm(f => ({ ...f, startsAt: e.target.value }))} className="flex-1 rounded border px-2 py-1 text-sm" />
                <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm(f => ({ ...f, endsAt: e.target.value }))} className="flex-1 rounded border px-2 py-1 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm(f => ({ ...f, allDay: e.target.checked }))} /> 全天</label>
              <input value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} placeholder="地点" className="w-full rounded border px-2 py-1 text-sm" />
              <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="描述" rows={2} className="w-full rounded border px-2 py-1 text-sm" />
              <input value={form.reminderMinutes} onChange={(e) => setForm(f => ({ ...f, reminderMinutes: e.target.value }))} placeholder="提前提醒(分钟)" type="number" className="w-full rounded border px-2 py-1 text-sm" />
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={handleSave} className="flex-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">保存</button>
              {editId && <button onClick={() => handleDelete(editId)} className="rounded border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">删除</button>}
              <button onClick={() => setShowEditor(false)} className="rounded border px-3 py-1.5 text-sm hover:bg-accent">取消</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
