'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileHomeDto, Remote } from './contracts'
import { mobileHomeSchema } from './schemas'

function stale(view: MobileHomeDto): MobileHomeDto {
  const mark = <T,>(source: Remote<T>): Remote<T> => source.state === 'ready' ? { ...source, state: 'stale' } : source
  return { ...view, agent: mark(view.agent), decisions: mark(view.decisions), activity: mark(view.activity), results: mark(view.results) }
}
export function useMobileHome(workspaceId: string) {
  const [state, setState] = useState<{ workspaceId: string; generation: number; view: MobileHomeDto | null; loading: boolean; error: boolean }>({ workspaceId, generation: 0, view: null, loading: true, error: false })
  const [generation, setGeneration] = useState(0)
  const sequence = useRef(0)
  const refresh = useCallback(() => setGeneration(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 60_000
    let running = false
    const number = ++sequence.current
    const schedule = () => { clearTimeout(timer); if (document.visibilityState === 'visible') timer = setTimeout(() => void load(), delay) }
    async function load() {
      if (running || controller.signal.aborted) return
      running = true
      const requestController = new AbortController()
      let requestTimer: ReturnType<typeof setTimeout> | undefined
      const abortRequest = () => { clearTimeout(requestTimer); requestController.abort() }
      controller.signal.addEventListener('abort', abortRequest, { once: true })
      try {
        if (!workspaceId) throw new Error('매장 확인 필요')
        // Bound headers and body together, including transports that ignore abort.
        const payload = await Promise.race([
          (async () => {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-home`, { cache: 'no-store', signal: requestController.signal })
            if (!response.ok) throw new Error('조회 실패')
            return response.json()
          })(),
          new Promise<never>((_, reject) => {
            requestTimer = setTimeout(() => {
              requestController.abort()
              reject(new Error('조회 시간 초과'))
            }, 15_000)
          }),
        ])
        const view = mobileHomeSchema.parse(payload)
        if (view.workspaceId !== workspaceId) throw new Error('매장 확인 필요')
        if (!controller.signal.aborted && number === sequence.current) setState({ workspaceId, generation, view, loading: false, error: false })
        delay = 60_000
      } catch {
        if (!controller.signal.aborted && number === sequence.current) setState(previous => ({ workspaceId, generation, view: previous.workspaceId === workspaceId && previous.view ? stale(previous.view) : null, loading: false, error: true }))
        delay = Math.min(delay * 2, 240_000)
      } finally {
        clearTimeout(requestTimer)
        controller.signal.removeEventListener('abort', abortRequest)
        running = false
        if (!controller.signal.aborted) schedule()
      }
    }
    const visible = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [workspaceId, generation])
  const sameWorkspace = state.workspaceId === workspaceId
  const pending = !sameWorkspace || state.generation !== generation
  return { view: sameWorkspace && state.view ? pending ? stale(state.view) : state.view : null, loading: pending || state.loading, error: !pending && state.error, refresh }
}
