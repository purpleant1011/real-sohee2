'use client'

import { useCallback, useEffect } from 'react'
import { useOptionalWorkspaceContext } from './use-workspace-context'
import { useAutonomy } from '@/features/mobile-today/use-autonomy'

const AUTONOMY_EVENT_KEY = 'sohee:autonomy_change'
const LEGACY_STORAGE_KEY = 'sohee_agent_autonomy_state_v1'

/** 레거시 Dock/R1도 모바일과 같은 서버 actual 상태·readback 경로를 사용한다. */
export function useSoheeAutonomy(customWorkspaceId?: string) {
  const context = useOptionalWorkspaceContext()
  const workspaceId = customWorkspaceId && customWorkspaceId !== 'ws-default'
    ? customWorkspaceId
    : context?.workspaceId || ''
  const controller = useAutonomy(workspaceId)
  const { refresh } = controller

  useEffect(() => {
    const changed = (event: Event) => {
      const scope = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!scope || scope === workspaceId) refresh()
    }
    const stored = (event: StorageEvent) => {
      // 값은 읽지 않는다. 구 전역 키도 재조회 신호로만 취급한다.
      if (event.key === LEGACY_STORAGE_KEY || event.key === `${LEGACY_STORAGE_KEY}:${workspaceId}`) refresh()
    }
    window.addEventListener(AUTONOMY_EVENT_KEY, changed)
    window.addEventListener('storage', stored)
    return () => {
      window.removeEventListener(AUTONOMY_EVENT_KEY, changed)
      window.removeEventListener('storage', stored)
    }
  }, [workspaceId, refresh])

  const setAutonomy = useCallback(async (running: boolean) => {
    const outcome = await controller.setPaused(!running)
    if (outcome.ok) window.dispatchEvent(new CustomEvent(AUTONOMY_EVENT_KEY, { detail: { workspaceId } }))
    return outcome
  }, [controller.setPaused, workspaceId])
  const confirmed = controller.load === 'ready' && controller.state !== null
  const actualMode = confirmed ? controller.state!.actualMode : 'UNKNOWN'
  const isRunning = actualMode === 'RUNNING' && controller.state?.killSwitchActive === false
  const toggleAutonomy = useCallback(() => setAutonomy(!isRunning), [setAutonomy, isRunning])

  return {
    isRunning,
    isPaused: !isRunning,
    actualMode,
    killSwitchActive: confirmed && controller.state!.killSwitchActive,
    isLoading: controller.load === 'loading',
    isStale: controller.load === 'error',
    observedAt: confirmed ? controller.state!.observedAt : null,
    setAutonomy,
    toggleAutonomy,
    refreshControlState: refresh,
  }
}
