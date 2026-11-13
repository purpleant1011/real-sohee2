'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadState } from '../mobile-decision/contracts'
import { toWorkList, type WorkRow } from './work-items'

export interface WorkItemsResult {
  items: WorkRow[]
  loadState: LoadState
  complete: boolean
  refresh: () => void
  nextCursor?: string | null
  loadMore?: () => void
}

/** 작업 목록 조회. 실패를 0건으로 바꾸지 않고 error/stale 로 남긴다. */
export function useWorkItems(workspaceId: string): WorkItemsResult {
  const [state, setState] = useState<{ workspaceId: string; items: WorkRow[]; loadState: LoadState; complete: boolean; nextCursor: string | null }>({
    workspaceId,
    items: [],
    loadState: 'loading',
    complete: false,
    nextCursor: null,
  })
  const [cursor, setCursor] = useState<{ workspaceId: string; value: string | null }>({ workspaceId, value: null })
  if (cursor.workspaceId !== workspaceId) setCursor({ workspaceId, value: null })
  const requestCursor = cursor.workspaceId === workspaceId ? cursor.value : null
  const [generation, setGeneration] = useState(0)
  const sequence = useRef(0)
  const refresh = useCallback(() => {
    setCursor({ workspaceId, value: null })
    setGeneration(value => value + 1)
  }, [workspaceId])
  const loadMore = () => {
    if (state.workspaceId === workspaceId && state.nextCursor) setCursor({ workspaceId, value: state.nextCursor })
  }

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 60_000
    let running = false
    const number = ++sequence.current
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = setTimeout(() => void load(true), delay)
    }
    async function load(fromStart = false) {
      if (running || controller.signal.aborted) return
      if (fromStart && requestCursor) {
        setCursor({ workspaceId, value: null })
        return
      }
      running = true
      const requestController = new AbortController()
      let requestTimer: ReturnType<typeof setTimeout> | undefined
      const abortRequest = () => {
        clearTimeout(requestTimer)
        requestController.abort()
      }
      controller.signal.addEventListener('abort', abortRequest, { once: true })
      try {
        if (!workspaceId) throw new Error('매장 확인 필요')
        // Bound both the headers and body read, even if a transport ignores abort.
        const payload = await Promise.race([
          (async () => {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/content?view=mobile-list${requestCursor ? `&cursor=${encodeURIComponent(requestCursor)}` : ''}`, {
              cache: 'no-store',
              signal: requestController.signal,
            })
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
        const result = toWorkList(payload, workspaceId)
        if (result.error) throw new Error('조회 실패')
        if (!controller.signal.aborted && number === sequence.current) {
          setState(previous => ({
            workspaceId,
            items: requestCursor && previous.workspaceId === workspaceId
              ? [...new Map([...previous.items, ...result.items].map(item => [item.id, item])).values()]
              : result.items,
            loadState: 'ready',
            complete: result.complete,
            nextCursor: typeof payload?.nextCursor === 'string' ? payload.nextCursor : null,
          }))
        }
        delay = 60_000
      } catch {
        if (!controller.signal.aborted && number === sequence.current) {
          setState(previous => ({
            workspaceId,
            complete: false,
            nextCursor: previous.workspaceId === workspaceId ? previous.nextCursor : null,
            items: previous.workspaceId === workspaceId ? previous.items : [],
            loadState: previous.workspaceId === workspaceId && previous.items.length > 0 ? 'stale' : 'error',
          }))
        }
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
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [workspaceId, generation, requestCursor])

  const sameWorkspace = state.workspaceId === workspaceId
  return {
    items: sameWorkspace ? state.items : [],
    loadState: sameWorkspace ? state.loadState : 'loading',
    complete: sameWorkspace && state.complete,
    nextCursor: sameWorkspace ? state.nextCursor : null,
    loadMore,
    refresh,
  }
}
