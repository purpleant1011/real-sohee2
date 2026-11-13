'use client'

import type { ReactNode } from 'react'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Autonomy } from '@/features/mobile-settings/r2-autonomy'

/**
 * M24 자율근무 진입점(ANI-1712).
 * 기존 화면은 서버가 그린 children 으로 받는다 — 이 컴포넌트는 다시 조회하지 않는다.
 * 플래그 OFF(기본)·넓은 화면은 기존 V088 화면 그대로다.
 */
export function AutomationEntry({ workspaceId, legacy }: { workspaceId: string; legacy: ReactNode }) {
  return useMobileR2Active() ? <R2Autonomy workspaceId={workspaceId} /> : <>{legacy}</>
}
