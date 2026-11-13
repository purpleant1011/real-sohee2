import { vi } from 'vitest'

type Listener = () => void

/**
 * jsdom에는 matchMedia가 없다. query별 matches 값을 정하고, 값을 바꿔 change 이벤트를 흘려 보낼 수 있다.
 */
export function mockMatchMedia(initial: Record<string, boolean> = {}) {
  const state = new Map<string, boolean>(Object.entries(initial))
  const listeners = new Map<string, Set<Listener>>()

  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return state.get(query) ?? false
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(cb)
    },
    removeEventListener: (_: string, cb: Listener) => {
      listeners.get(query)?.delete(cb)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))

  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia })

  return {
    set(query: string, matches: boolean) {
      state.set(query, matches)
      listeners.get(query)?.forEach((cb) => cb())
    },
    restore() {
      // @ts-expect-error jsdom 기본 상태로 되돌린다
      delete window.matchMedia
    },
  }
}
