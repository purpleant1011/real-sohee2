'use client'

import { useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileCustomersView, customersScreenConfig } from './customers-view'
import { useCustomersSnapshot } from './customers-snapshot'

/**
 * M17 고객 — R2 셸 배선(ANI-1771, 플래그 뒤).
 * GET /api/workspaces/:id/mobile-customers 읽기만 사용한다. 연락·전송 경로는 없고(CTA 는 서버가 근거를 줄 때만 활성),
 * 응답은 no-store 로 받으며 브라우저 저장소에 남기지 않는다.
 */
export function R2Customers({ workspaceId }: { workspaceId: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const snapshot = useCustomersSnapshot(workspaceId, refreshKey)
  const { mode, title } = customersScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileCustomersView snapshot={snapshot} readOnlyContacts onRetry={() => setRefreshKey(value => value + 1)} />
      </ShellScreen>
    </MobileAppShell>
  )
}
