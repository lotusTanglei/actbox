// src/components/nav/NavBar.tsx

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/', label: '📋 待办', icon: '📋' },
  { href: '/mails', label: '📬 邮件', icon: '📬' },
  { href: '/settings', label: '⚙️ 设置', icon: '⚙️' },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex max-w-2xl items-center gap-1 px-4 py-2">
        <Link href="/" className="mr-4 text-lg font-bold">
          📬 ActBox
        </Link>
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href))
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
