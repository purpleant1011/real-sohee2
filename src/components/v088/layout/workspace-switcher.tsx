'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * ANI-1779: 앱 셸의 가게 선택기.
 *
 * - 표시 이름은 서버(layout)가 확인한 이름만 쓴다. 없으면 "가게 이름 확인 중" — 추측 금지.
 * - 목록은 GET /api/workspaces, 전환은 POST /api/workspaces/active (서버가 멤버십 재검증).
 * - 조회 실패(ERROR)와 0건(EMPTY)을 구분해 안내한다.
 * - 전환 성공 시 화면을 다시 열어 서버 판정과 화면이 같은 가게를 가리키게 한다.
 */

export type WorkspaceSwitcherItem = Readonly<{
  id: string
  name: string | null
  role: string
}>

type ListState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; items: readonly WorkspaceSwitcherItem[] }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'error' }>

type WorkspaceSwitcherProps = Readonly<{
  activeId: string
  activeName: string | null
  fellBack?: boolean
  /** 활성 가게가 2개 이상일 때만 목록을 연다. 1개면 이름만 보여 준다(전환 대상 없음). */
  switchable?: boolean
  /** 테스트에서 페이지 새로고침을 대체하기 위한 훅. 기본은 실제 새로고침. */
  onSwitched?: () => void
}>

export function parseWorkspaceListPayload(
  value: unknown,
): Readonly<{ loadState: 'ready' | 'empty'; items: readonly WorkspaceSwitcherItem[] }> | null {
  if (!value || typeof value !== 'object') return null
  const data = (value as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null

  const record = data as Record<string, unknown>
  const loadState = record.loadState
  if (loadState !== 'ready' && loadState !== 'empty') return null

  const rawItems = loadState === 'ready' ? record.workspaces : []
  if (!Array.isArray(rawItems)) return null

  const items: WorkspaceSwitcherItem[] = []
  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index]
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id.length === 0) return null
    items[index] = {
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : null,
      role: typeof item.role === 'string' ? item.role : '',
    }
  }

  return { loadState, items }
}

function reloadPage() {
  if (typeof window !== 'undefined') window.location.reload()
}

export function WorkspaceSwitcher({
  activeId,
  activeName,
  fellBack = false,
  switchable = true,
  onSwitched = reloadPage,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const displayName = activeName?.trim() || '가게 이름 확인 중'

  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    fetch('/api/workspaces', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('WORKSPACE_LIST_UNAVAILABLE')
        const payload = parseWorkspaceListPayload(await response.json())
        if (!payload) throw new Error('WORKSPACE_LIST_INVALID')
        if (!active) return
        setListState(payload.loadState === 'empty'
          ? { status: 'empty' }
          : { status: 'ready', items: payload.items })
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return
        setListState({ status: 'error' })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [open, reloadToken])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = useCallback(async (workspaceId: string) => {
    if (workspaceId === activeId || switchingId) {
      setOpen(false)
      return
    }
    setSwitchError(null)
    setSwitchingId(workspaceId)
    try {
      const response = await fetch('/api/workspaces/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      if (!response.ok) {
        setSwitchError(response.status === 403
          ? '이 가게에 접근할 권한이 없어요.'
          : '가게를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      onSwitched()
    } catch {
      setSwitchError('가게를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSwitchingId(null)
    }
  }, [activeId, onSwitched, switchingId])

  // 사령관 결정(2026-10-24): 활성 가게가 1개면 전환 대상이 없으므로 이름만 보여 준다.
  if (!switchable) {
    return (
      <div className="flex flex-col gap-1.5 min-w-0" title={displayName}>
        <div className="flex items-center justify-center xl:justify-start gap-2.5 px-2 py-1.5 -mx-2">
          <span className="w-2.5 h-2.5 rounded-full bg-state-ok shrink-0" aria-hidden="true" />
          <span
            className="hidden xl:inline text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate max-w-[150px]"
          >
            {displayName}
          </span>
        </div>
        {fellBack ? (
          <p role="status" className="hidden xl:block text-xs text-[var(--v088-muted)] leading-snug max-w-[220px]">
            선택한 가게에 접근할 수 없어 지금 가게로 열었어요.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5 min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`가게 선택: ${displayName}`}
        title={displayName}
        onClick={() => {
          setSwitchError(null)
          // 열 때마다 서버에서 다시 읽는다(다른 탭에서 바뀐 멤버십 반영).
          setListState({ status: 'loading' })
          setOpen((next) => !next)
        }}
        className="flex items-center justify-center xl:justify-start gap-2.5 px-2 py-1.5 -mx-2 rounded-xl hover:bg-[var(--v088-surface-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
      >
        <span className="w-2.5 h-2.5 rounded-full bg-state-ok shrink-0" aria-hidden="true" />
        <span
          className="hidden xl:inline text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate max-w-[150px]"
        >
          {displayName}
        </span>
        <ChevronDown className="hidden xl:inline w-3.5 h-3.5 text-[var(--v088-muted)] shrink-0" aria-hidden="true" />
      </button>

      {fellBack ? (
        <p role="status" className="hidden xl:block text-xs text-[var(--v088-muted)] leading-snug max-w-[220px]">
          선택한 가게에 접근할 수 없어 지금 가게로 열었어요.
        </p>
      ) : null}

      {open ? (
        <div
          role="menu"
          aria-label="가게 목록"
          className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl border border-[var(--v088-border)] bg-[var(--v088-surface)] shadow-lg p-1.5 z-50"
        >
          {listState.status === 'loading' ? (
            <p role="status" className="px-3 py-2.5 text-xs text-[var(--v088-muted)]">
              가게 목록을 불러오는 중이에요.
            </p>
          ) : null}

          {listState.status === 'error' ? (
            <div className="px-3 py-2.5">
              <p role="alert" className="text-xs text-state-danger font-semibold">
                가게 목록을 불러오지 못했어요.
              </p>
              <button
                type="button"
                onClick={() => {
                  setListState({ status: 'loading' })
                  setReloadToken((token) => token + 1)
                }}
                className="mt-2 text-xs font-bold text-primary hover:underline cursor-pointer"
              >
                다시 시도
              </button>
            </div>
          ) : null}

          {listState.status === 'empty' ? (
            <p role="status" className="px-3 py-2.5 text-xs text-[var(--v088-muted)]">
              연결된 가게가 없어요.
            </p>
          ) : null}

          {listState.status === 'ready' ? listState.items.map((item) => {
            const isActive = item.id === activeId
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={switchingId !== null}
                onClick={() => void handleSelect(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left text-sm cursor-pointer disabled:cursor-wait ${isActive
                  ? 'bg-primary/10 text-[var(--v088-ink)] font-bold'
                  : 'text-[var(--v088-ink)] hover:bg-[var(--v088-surface-subtle)]'}`}
              >
                <span className="truncate">{item.name ?? '이름 미확인'}</span>
                {isActive ? <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> : null}
              </button>
            )
          }) : null}

          {switchingId ? (
            <p role="status" className="px-3 py-2 text-xs text-[var(--v088-muted)]">
              가게를 바꾸는 중이에요.
            </p>
          ) : null}

          {switchError ? (
            <p role="alert" className="px-3 py-2 text-xs text-state-danger font-semibold">
              {switchError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
