// src/components/search/SearchSuggest.tsx
// 搜索输入联想：历史 + 操作符补全。plan-07 Task 8 拆分自 SearchBar。

'use client'

interface SearchSuggestProps {
  historyItems: string[]
  operatorHints: string[]
  onPick: (value: string) => void
}

export function SearchSuggest({ historyItems, operatorHints, onPick }: SearchSuggestProps) {
  if (historyItems.length === 0 && operatorHints.length === 0) return null

  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-border bg-popover shadow-lg">
      {historyItems.length > 0 && (
        <div className="border-b border-border p-1">
          <p className="px-2 py-0.5 text-[10px] text-muted-foreground">历史</p>
          {historyItems.map((h) => (
            <button
              key={h}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(h)
              }}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent"
            >
              🕘 {h}
            </button>
          ))}
        </div>
      )}
      {operatorHints.length > 0 && (
        <div className="p-1">
          <p className="px-2 py-0.5 text-[10px] text-muted-foreground">操作符</p>
          {operatorHints.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(o)
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent"
            >
              ⌘ {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
