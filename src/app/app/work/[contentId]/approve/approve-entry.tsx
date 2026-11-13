'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2WorkApprove } from '@/features/mobile-approvals/r2-work-approve'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

/** 기존 승인 화면(작업 상세). 플래그 OFF·넓은 화면이 되돌아갈 곳. */
export function legacyWorkApprovePath(contentId: string): string {
  return `/app/work/${encodeURIComponent(contentId)}`
}

/**
 * 게시 전 최종 확인 진입점(M07).
 *
 * 좁은 화면 + 플래그 ON 에서만 R2 승인 화면(5탭 숨김·단일 CTA)을 마운트한다.
 * 그 밖에는 기존 작업 상세로 이동한다 — 같은 승인을 두 UI 로 동시에 그리지 않는다.
 */
export function WorkApproveEntry({
  workspaceId,
  contentId,
  role,
  snapshot,
}: Readonly<{
  workspaceId: string
  contentId: string
  role: string
  snapshot: ApprovalPreviewSnapshot | null
}>) {
  const active = useMobileR2Active()
  const router = useRouter()

  useEffect(() => {
    if (!active) router.replace(legacyWorkApprovePath(contentId))
  }, [active, contentId, router])

  if (!active) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">작업 화면으로 이동하고 있어요.</p>
  }
  return (
    <MobileAppShell>
      <R2WorkApprove workspaceId={workspaceId} contentId={contentId} role={role} snapshot={snapshot} />
    </MobileAppShell>
  )
}
