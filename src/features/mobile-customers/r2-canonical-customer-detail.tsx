'use client'

import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import {
  CanonicalCustomerDetailView,
  canonicalCustomerDetailScreenConfig,
} from './canonical-customer-detail-view'

/**
 * M17 번호 기준 정본 고객 상세 — R2 셸 배선.
 *
 * GET /api/workspaces/:id/customers/canonical 및
 * GET /api/workspaces/:id/kakao/outbox?customerUuid=:uuid 읽기만 쓴다.
 * 고객 개인정보이므로 응답을 캐시·브라우저 저장소에 남기지 않고,
 * 전화번호는 마스킹된 형태로만 노출한다.
 */
export function R2CanonicalCustomerDetail({
  workspaceId,
  customerUuid,
}: {
  workspaceId: string
  customerUuid: string
}) {
  const { mode, title, backHref } = canonicalCustomerDetailScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} backHref={backHref}>
        <CanonicalCustomerDetailView
          workspaceId={workspaceId}
          customerUuid={customerUuid}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
