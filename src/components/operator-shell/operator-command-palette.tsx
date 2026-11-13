'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import type { OperatorNavigationItem } from './operator-navigation'

type PaletteEntry = Readonly<{ key: string; label: string; hint: string; href: string }>

type Props = Readonly<{
  items: readonly OperatorNavigationItem[]
  canSearchWorkspaces: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}>

export function OperatorCommandPalette({ items, canSearchWorkspaces, open, onOpenChange }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const trimmed = query.trim()
  const entries = useMemo<readonly PaletteEntry[]>(() => {
    const needle = trimmed.toLowerCase()
    const matched = items
      .filter((item) => needle === '' || `${item.label} ${item.description ?? ''}`.toLowerCase().includes(needle))
      .map((item) => ({ key: item.href, label: item.label, hint: item.description ?? '', href: item.href }))
    if (trimmed !== '' && canSearchWorkspaces) {
      return [
        {
          key: 'workspace-search',
          label: `고객사 검색: ${trimmed}`,
          hint: '고객사 목록에서 찾기',
          href: `/admin/workspaces?query=${encodeURIComponent(trimmed)}`,
        },
        ...matched,
      ]
    }
    return matched
  }, [items, trimmed, canSearchWorkspaces])

  function close() {
    onOpenChange(false)
    setQuery('')
    setActive(0)
  }

  function go(entry: PaletteEntry | undefined) {
    if (!entry) return
    router.push(entry.href)
    close()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (next) onOpenChange(true); else close() }}
      restoreFocusFallbackSelector="[data-operator-palette-trigger]"
      title="빠른 이동"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-purple-500/40">
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          <input
            aria-activedescendant={entries[active] ? `operator-palette-${entries[active].key.replace(/\W/g, "_")}` : undefined}
            aria-controls="operator-palette-list"
            aria-label="메뉴 또는 고객사 검색"
            autoFocus
            className="h-11 w-full bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, entries.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (event.key === 'Enter') { event.preventDefault(); go(entries[active]) }
            }}
            placeholder="메뉴 이름이나 고객사 이름을 입력하세요"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            value={query}
          />
        </div>
        <ul
          aria-label="검색 결과"
          className="max-h-80 space-y-1 overflow-y-auto"
          id="operator-palette-list"
          role="listbox"
        >
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              aria-selected={index === active}
              className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-2 text-sm ${index === active ? 'bg-purple-500/10 text-purple-800 dark:text-purple-200' : 'hover:bg-muted'}`}
              id={`operator-palette-${entry.key.replace(/\W/g, "_")}`}
              onClick={() => go(entry)}
              onMouseEnter={() => setActive(index)}
              role="option"
            >
              <span className="font-medium">{entry.label}</span>
              {entry.hint ? <span className="text-xs text-muted-foreground">{entry.hint}</span> : null}
            </li>
          ))}
        </ul>
        {entries.length === 0 ? <p className="px-1 text-sm text-muted-foreground">일치하는 메뉴가 없어요.</p> : null}
      </div>
    </Dialog>
  )
}
