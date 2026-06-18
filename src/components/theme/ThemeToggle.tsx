// src/components/theme/ThemeToggle.tsx
'use client'
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  const next = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light'
  const label = pref === 'light' ? '☀️ 浅色' : pref === 'dark' ? '🌙 暗色' : '🖥️ 跟随系统'
  return (
    <button onClick={() => setPref(next)} aria-label="切换主题" className="rounded border px-2 py-1 text-sm hover:bg-accent">
      {label}
    </button>
  )
}
