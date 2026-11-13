'use client'

import { Suspense } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ScheduleEntry } from '@/app/app/schedule/schedule-entry'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { EMPTY_BOARD, PREVIEW_WORKSPACE_ID, buildLedgerPreviewSnapshot } from './fixture'

/**
 * M15 예약 장부 실라우트 진입점 육안 검수용(ANI-1691).
 *
 * 서버 라우트(`/app/schedule`)와 같은 진입점 컴포넌트(`ScheduleEntry`)를 그대로 마운트하되,
 * 로그인과 서버 조회 없이 고정 예시 스냅샷을 쓴다. 실제 원장 데이터가 아니므로 운영 증거가
 * 아니라 화면 배치·상태 확인용이다. 기존 일정 화면(`ScheduleBoard`)은 nuqs 어댑터를 쓴다.
 */
export function LedgerWiringHarness({ enabled, hasSnapshot, nowIso }: Readonly<{
  enabled: boolean
  hasSnapshot: boolean
  nowIso: string
}>) {
  const ledger = hasSnapshot ? buildLedgerPreviewSnapshot(new Date(nowIso)) : null

  return (
    <main className="min-h-dvh bg-muted/40">
      <WorkspaceProvider value={{
        workspaceId: PREVIEW_WORKSPACE_ID,
        workspaceName: '예시 가게',
        workspaceKind: null,
        membershipRole: 'owner',
        actorId: 'dev-harness',
        resolutionSource: 'membership',
      }}>
        <MobileR2Provider enabled={enabled}>
          <Suspense fallback={null}>
            <NuqsAdapter>
              <ScheduleEntry
                board={{ data: EMPTY_BOARD, workspaceId: PREVIEW_WORKSPACE_ID, role: 'owner' }}
                ledger={ledger}
              />
            </NuqsAdapter>
          </Suspense>
        </MobileR2Provider>
      </WorkspaceProvider>
    </main>
  )
}
