// src/components/theme/ThemeProvider.tsx
'use client'
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { resolveTheme, type ThemePref, type ResolvedTheme } from '@/lib/theme/resolve'

interface Ctx { pref: ThemePref; resolved: ResolvedTheme; setPref: (p: ThemePref) => void }
const ThemeCtx = createContext<Ctx>(null as any)
export const useTheme = () => useContext(ThemeCtx)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('system')
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as ThemePref) || 'system'
    setPrefState(saved)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setPrefersDark(mq.matches)
    const onChange = () => setPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(pref, prefersDark)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p); localStorage.setItem('theme', p)
  }, [])

  return <ThemeCtx.Provider value={{ pref, resolved, setPref }}>{children}</ThemeCtx.Provider>
}
