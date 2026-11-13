'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutonomyServerState } from './autonomy-state'

export type AutonomyLoad = 'loading' | 'ready' | 'error'
export type AutonomyControlResult =
  | { ok: true }
  | { ok: false; kind: 'conflict' | 'forbidden' | 'failed'; message: string }

export interface AutonomyController {
  state: AutonomyServerState | null
  load: AutonomyLoad
  errorMessage: string
  conflict: boolean
  refresh: () => void
  setPaused: (paused: boolean) => Promise<AutonomyControlResult>
}

const MODES = ['OFF', 'ARMING', 'RUNNING', 'DEGRADED', 'PAUSED', 'BLOCKED'] as const

/** fetch가 signal을 무시하거나 JSON 본문이 멎어도 요청·판독 전체를 8초로 제한한다. */
async function controlRequest(url: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => controller.abort()
  const gate = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('상태 확인 시간 초과 또는 취소')), { once: true })
    timer = setTimeout(cancel, 8000)
  })
  init.signal?.addEventListener('abort', cancel, { once: true })
  if (init.signal?.aborted) cancel()
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const payload = init.method === 'POST' || !response.ok ? null : await response.json()
      return { response, payload }
    })(), gate])
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', cancel)
  }
}

export function parseAutonomyState(payload: unknown, workspaceId: string): AutonomyServerState | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  if (raw.workspaceId !== workspaceId) return null
  const desiredMode = raw.desiredMode
  const actualMode = raw.actualMode
  if (desiredMode !== 'OFF' && desiredMode !== 'RUNNING' && desiredMode !== 'PAUSED') return null
  if (typeof actualMode !== 'string' || !(MODES as readonly string[]).includes(actualMode)) return null
  if (typeof raw.version !== 'number' || !Number.isSafeInteger(raw.version) || raw.version < 1) return null
  if (typeof raw.killSwitchActive !== 'boolean') return null
  const observedAt = raw.updated_at ?? raw.updatedAt
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) return null
  const count = raw.activeActionRunCount ?? raw.active_action_run_count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null
  return {
    desiredMode,
    actualMode: actualMode as AutonomyServerState['actualMode'],
    activeActionRunCount: count,
    killSwitchActive: raw.killSwitchActive === true,
    version: raw.version,
    observedAt,
  }
}

/** 자율근무 상태는 /agent/control 서버 readback만 정본으로 쓴다. 로컬 토글을 상태처럼 표시하지 않는다. */
export function useAutonomy(workspaceId: string): AutonomyController {
  const [state, setState] = useState<{ workspaceId: string; state: AutonomyServerState | null; load: AutonomyLoad; errorMessage: string; conflict: boolean }>({
    workspaceId,
    state: null,
    load: 'loading',
    errorMessage: '',
    conflict: false,
  })
  const [generation, setGeneration] = useState(0)
  const sequence = useRef(0)
  const mutation = useRef(false)
  const activeWorkspace = useRef(workspaceId)
  activeWorkspace.current = workspaceId
  const refresh = useCallback(() => setGeneration(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 60_000
    let running = false
    const number = ++sequence.current
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = setTimeout(() => void load(), delay)
    }
    async function load() {
      if (running || controller.signal.aborted) return
      running = true
      try {
        if (!workspaceId) throw new Error('매장 확인 필요')
        const { response, payload } = await controlRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/control`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('조회 실패')
        const next = parseAutonomyState(payload, workspaceId)
        if (!next) throw new Error('응답 확인 필요')
        if (!controller.signal.aborted && number === sequence.current) {
          setState({ workspaceId, state: next, load: 'ready', errorMessage: '', conflict: false })
        }
        delay = 60_000
      } catch (error) {
        if (!controller.signal.aborted && number === sequence.current) {
          setState(previous => ({
            workspaceId,
            state: previous.workspaceId === workspaceId ? previous.state : null,
            load: 'error',
            errorMessage: error instanceof Error ? error.message : '상태를 확인하지 못했어요',
            conflict: false,
          }))
        }
        delay = Math.min(delay * 2, 240_000)
      } finally {
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
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [workspaceId, generation])

  const setPaused = useCallback(async (paused: boolean): Promise<AutonomyControlResult> => {
    const current = state.state
    if (mutation.current || state.load !== 'ready' || !current || state.workspaceId !== workspaceId) {
      return { ok: false, kind: 'failed', message: '상태를 다시 확인한 뒤 시도해 주세요.' }
    }
    let accepted = false
    mutation.current = true
    sequence.current += 1
    setState(previous => ({ ...previous, load: 'loading' }))
    try {
      const { response } = await controlRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          action: 'set_mode',
          desiredMode: paused ? 'PAUSED' : 'RUNNING',
          expectedVersion: current.version,
          reason: paused ? '모바일에서 자율근무 중지' : '모바일에서 자율근무 재개',
        }),
      })
      if (activeWorkspace.current !== workspaceId) return { ok: false, kind: 'failed', message: '다른 매장으로 이동했어요. 상태를 다시 확인해 주세요.' }
      if (response.status === 409) {
        setState(previous => ({ ...previous, load: 'error', conflict: true, errorMessage: '다른 기기에서 먼저 바뀌었어요. 최신 상태를 다시 확인해 주세요.' }))
        return { ok: false, kind: 'conflict', message: '다른 기기에서 먼저 바뀌었어요. 최신 상태를 다시 확인해 주세요.' }
      }
      if (response.status === 403) {
        setState(previous => ({ ...previous, load: 'ready' }))
        return { ok: false, kind: 'forbidden', message: '자율근무 제어는 작업공간 소유자 또는 관리자만 할 수 있어요.' }
      }
      if (!response.ok) {
        setState(previous => ({ ...previous, load: 'error' }))
        return { ok: false, kind: 'failed', message: '변경을 적용하지 못했어요. 잠시 후 다시 확인해 주세요.' }
      }
      // 서버 accepted. 표시는 반드시 readback으로 다시 채운다.
      accepted = true
      return { ok: true }
    } catch {
      if (activeWorkspace.current === workspaceId) setState(previous => ({ ...previous, load: 'error' }))
      return { ok: false, kind: 'failed', message: '연결을 확인하지 못했어요. 상태는 바뀌지 않았을 수 있어요.' }
    } finally {
      mutation.current = false
      if (accepted && activeWorkspace.current === workspaceId) refresh()
    }
  }, [state.state, state.load, state.workspaceId, workspaceId, refresh])

  const sameWorkspace = state.workspaceId === workspaceId
  return {
    state: sameWorkspace ? state.state : null,
    load: sameWorkspace ? state.load : 'loading',
    errorMessage: sameWorkspace ? state.errorMessage : '',
    conflict: sameWorkspace ? state.conflict : false,
    refresh,
    setPaused,
  }
}
