'use client'

import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileCustomerDetailView, customerDetailScreenConfig } from './customer-detail-view'
import { useCustomersSnapshot } from './customers-snapshot'

/**
 * M17b 고객 상세 — R2 셸 배선(ANI-1664, 플래그 뒤).
 *
 * 목록과 같은 GET /api/workspaces/:id/mobile-customers 읽기만 쓴다(no-store, 연락처 값 없음).
 * 고객 개인정보이므로 응답을 캐시·브라우저 저장소에 남기지 않고, 서버 쓰기·연락 전송 경로를 만들지 않는다.
 */
export function R2CustomerDetail({ workspaceId, customerId }: { workspaceId: string; customerId: string }) {
  const snapshot = useCustomersSnapshot(workspaceId)
  const { mode, title, backHref } = customerDetailScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} backHref={backHref}>
        <MobileCustomerDetailView snapshot={snapshot} customerId={customerId} readOnlyContacts />
      </ShellScreen>
    </MobileAppShell>
  )
}
