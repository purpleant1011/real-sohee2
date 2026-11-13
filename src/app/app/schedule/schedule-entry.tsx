'use client'

import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { MobileLedgerView, type LedgerViewSnapshot } from '@/features/mobile-inbox/ledger-view'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { ScheduleBoard } from '@/features/schedule/schedule-board'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'

type BoardProps = Parameters<typeof ScheduleBoard>[0]

/**
 * /app/schedule 진입 게이트 (ANI-1691 M15).
 *
 * 플래그 ON + 767px 이하에서만 R2 예약 장부(`MobileLedgerView`)를 그린다. 그 밖(플래그 OFF·PC·태블릿)은
 * 기존 `ScheduleBoard` 그대로다 — 고객 목록(`customers-entry.tsx`)과 같은 방식.
 * PC에서는 V088AppShell로 감싸 사이드바와 상단 헤더를 온전히 제공한다.
 *
 * 장부는 조회 전용이다. 예약을 만들거나 바꾸는 버튼을 두지 않고, '새로 확인'만 서버를 다시 읽는다.
 * 스냅샷은 플래그 OFF 면 서버가 아예 만들지 않으므로(원장 조회 0) 여기서도 null 이다.
 */
export function ScheduleEntry({ board, ledger }: Readonly<{
  board: BoardProps
  ledger: LedgerViewSnapshot | null
}>) {
  const active = useMobileR2Active()
  const router = useRouter()

  if (active && ledger) {
    return <MobileLedgerView snapshot={ledger} onRefresh={() => router.refresh()} />
  }
  return (
    <V088AppShell workspaceId={board.workspaceId}>
      <Suspense fallback={null}>
        <NuqsAdapter>
          <ScheduleBoard {...board} />
        </NuqsAdapter>
      </Suspense>
    </V088AppShell>
  )
}
