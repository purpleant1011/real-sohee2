'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2ApprovalDetail } from '@/features/mobile-approvals/r2-approval-view'

/** 기존 상세 화면(쿼리 경로). 플래그 OFF·넓은 화면이 되돌아갈 곳. */
export function legacyApprovalDetailPath(item: string): string {
  return `/app/approvals?item=${encodeURIComponent(item)}`
}

/**
 * 승인 상세 진입점(ANI-1664).
 *
 * 좁은 화면 + 플래그 ON 에서만 R2 상세(5탭 숨김·단일 CTA)를 마운트한다.
 * 그 밖에는 기존 상세 화면으로 이동한다 — 같은 내용을 두 UI 로 동시에 그리지 않는다.
 */
export function ApprovalDetailEntry({ workspaceId, item }: { workspaceId: string; item: string }) {
  const active = useMobileR2Active()
  const router = useRouter()

  useEffect(() => {
    if (!active) router.replace(legacyApprovalDetailPath(item))
  }, [active, item, router])

  if (!active) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">확인 화면으로 이동하고 있어요.</p>
  }
  return (
    <MobileAppShell>
      <R2ApprovalDetail item={item} workspaceId={workspaceId} />
    </MobileAppShell>
  )
}
