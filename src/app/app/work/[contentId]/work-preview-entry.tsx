'use client'

import type { ReactNode } from 'react'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import type { DatasetMode } from '@/features/mobile-firstpost/dataset-mode'
import { R2WorkPreview, isPreviewChannel } from '@/features/mobile-firstpost/r2-work-preview'

/**
 * M06 홍보 세트 진입점 (`/app/work/:id`, 플래그 ON + allowlist 만).
 *
 * - 플래그 OFF·넓은 화면: `children`(오늘의 작업 상세)을 그대로 그린다. 새 동작 없음.
 * - M06 이 다루지 않는 채널(네이버 블로그): 역시 기존 상세를 그대로 둔다. 화면이 채널
 *   규격을 흉내 내지 않는다.
 * - 스냅샷 조회 실패(`null`)는 기존 화면으로 숨기지 않는다. R2 화면이 '불러오지 못했어요'
 *   로 말한다 — 조회 실패를 '미리보기 없음'으로 바꾸지 않는다.
 */
export function WorkPreviewEntry({
  snapshot,
  datasetMode = 'ACTUAL',
  children,
}: Readonly<{
  snapshot: ApprovalPreviewSnapshot | null
  /** 실라우트는 실제 스냅샷이므로 기본값 `ACTUAL`. 개발 하네스만 예시 값을 넘긴다. */
  datasetMode?: DatasetMode
  children: ReactNode
}>) {
  const active = useMobileR2Active()
  if (!active) return <>{children}</>
  if (snapshot && !isPreviewChannel(snapshot.channel)) return <>{children}</>

  return (
    <MobileAppShell>
      <R2WorkPreview
        key={snapshot ? `${snapshot.versionId}|${snapshot.fingerprint}|${datasetMode}` : 'unavailable'}
        snapshot={snapshot}
        datasetMode={datasetMode}
      />
    </MobileAppShell>
  )
}
