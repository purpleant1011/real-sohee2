'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2WeeklyReport } from '@/features/mobile-results/r2-weekly-report'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import LegacyReportsView from './reports-view'

/**
 * /app/reports 분기. 플래그 ON · 767px 이하 · workspace allowlist 일 때만 R2 주간 보고로 그린다.
 * 그 밖(플래그 OFF·넓은 화면·allowlist 밖)은 기존 V088 셸 그대로다.
 *
 * PC 레거시 콘솔은 **기존 정적 import 그대로** 둔다 — dynamic 으로 바꾸면 PC 첫 렌더가 달라진다.
 * 모바일 번들 축소는 ANI-1741 성능 후속으로 분리한다.
 */
export function ReportsEntry() {
  const workspaceId = useWorkspaceId()
  return useMobileR2Active()
    ? <R2WeeklyReport workspaceId={workspaceId} />
    : <LegacyReportsView />
}
