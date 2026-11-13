'use client'

import { createContext, useContext, useEffect, useId, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { ShellScreenConfig } from './types'
import type { ViewportState } from './viewport'

/** 화면이 등록한 설정을 담는 아주 작은 외부 스토어(리렌더 범위를 셸로 한정). */
export interface ScreenStore {
  subscribe: (cb: () => void) => () => void
  get: () => ShellScreenConfig | null
  /** owner 가 등록. 마지막 등록이 이긴다(스택). 반환값 = 해제 함수 */
  register: (owner: string, config: ShellScreenConfig) => () => void
}

export function createScreenStore(): ScreenStore {
  let entries: Array<{ owner: string; config: ShellScreenConfig }> = []
  let snapshot: ShellScreenConfig | null = null
  const listeners = new Set<() => void>()
  const update = () => {
    snapshot = entries.length ? entries.reduce<ShellScreenConfig>((acc, cur) => ({ ...acc, ...cur.config }), {}) : null
    listeners.forEach(l => l())
  }
  return {
    subscribe: cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    get: () => snapshot,
    register(owner, config) {
      const i = entries.findIndex(e => e.owner === owner)
      entries = i === -1 ? [...entries, { owner, config }] : entries.map((e, idx) => idx === i ? { owner, config } : e)
      update()
      return () => { entries = entries.filter(e => e.owner !== owner); update() }
    },
  }
}

interface ShellContextValue {
  store: ScreenStore
  viewport: ViewportState
}
const ShellContext = createContext<ShellContextValue | null>(null)

export function ShellContextProvider({ store, viewport, children }: { store: ScreenStore; viewport: ViewportState; children: ReactNode }) {
  const value = useMemo(() => ({ store, viewport }), [store, viewport])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useHasMobileShell(): boolean {
  return useContext(ShellContext) !== null
}

function useShellContext(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('MobileAppShell 안에서만 사용할 수 있어요')
  return ctx
}

export function useScreenConfig(): ShellScreenConfig | null {
  const { store } = useShellContext()
  return useSyncExternalStore(store.subscribe, store.get, () => null)
}

/**
 * 화면 등록 API. 화면 컴포넌트에서 호출하면 헤더/모드/CTA 가 셸에 반영되고,
 * 언마운트 시 자동 해제된다. 같은 값이면 재등록하지 않도록 호출부에서 useMemo 를 권장.
 */
export function useShellScreen(config: ShellScreenConfig): void {
  const { store } = useShellContext()
  const owner = useId()
  // 설정이 바뀌면 같은 owner 로 갱신하고, 언마운트/변경 시 이전 등록을 해제한다.
  // 등록은 렌더가 아니라 effect 안에서만 한다(렌더 중 외부 스토어 변경 금지).
  useEffect(() => store.register(owner, config), [store, owner, config])
}

/** 셸이 없을 수도 있는 하위 컴포넌트에서 안전하게 쓰는 옵셔널 버전 */
export function useOptionalShellScreen(config: ShellScreenConfig | null): void {
  const ctx = useContext(ShellContext)
  const owner = useId()
  useEffect(() => {
    if (!ctx || !config) return
    return ctx.store.register(owner, config)
  }, [ctx, owner, config])
}

export function useShellViewport(): ViewportState {
  return useShellContext().viewport
}

/** 키보드 상태. 입력/CTA 가 가려지는지 판단할 때 사용. */
export function useKeyboard(): { open: boolean; height: number } {
  const { viewport } = useShellContext()
  return { open: viewport.keyboardOpen, height: viewport.keyboardHeight }
}

/** 화면에서 선언하는 컴포넌트 형태. */
export function ShellScreen(props: ShellScreenConfig & { children?: ReactNode }) {
  const { children, ...config } = props
  useShellScreen(config)
  return <>{children}</>
}
