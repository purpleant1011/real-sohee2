'use client'

import { useSearchParams } from 'next/navigation'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { PcApprovalsView } from '@/features/approvals/pc-approvals-view'
import { R2ApprovalDetail, R2ApprovalList } from '@/features/mobile-approvals/r2-approval-view'

/**
 * M19 승인 확인 배선.
 * - 모바일(좁은 화면/R2): MobileAppShell 기반 R2 승인 화면
 * - PC(넓은 화면): MasterDetail(왼쪽 목록 + 오른쪽 상세) 2단 구성
 */
export function ApprovalsEntry() {
  if (useMobileR2Active()) return <R2Approvals />
  return <PcApprovalsView />
}

function R2Approvals() {
  const workspaceId = useWorkspaceId()
  const item = useSearchParams()?.get('item') || null
  return (
    <MobileAppShell>
      {item ? <R2ApprovalDetail workspaceId={workspaceId} item={item} /> : <R2ApprovalList workspaceId={workspaceId} />}
    </MobileAppShell>
  )
}
