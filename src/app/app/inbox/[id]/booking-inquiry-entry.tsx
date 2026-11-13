'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2BookingTimeline } from '@/features/mobile-inbox/r2-booking-timeline'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { DesktopConversationReview } from '@/features/engagement/desktop-conversation-review'

/** 같은 case·원문·명령 게이트를 PC/모바일의 서로 다른 호스트에서 사용한다. */
export function BookingInquiryEntry({ caseId }: { caseId: string }) {
  const workspaceId = useWorkspaceId()
  const active = useMobileR2Active()
  if (active) return <R2BookingTimeline workspaceId={workspaceId} caseId={caseId} />
  return <V088AppShell workspaceId={workspaceId}><DesktopConversationReview title="예약 문의 관리" description="선택한 문의의 제안·고객 수락·예약 원장 근거를 같은 케이스에서 확인해요." backHref="/app/inbox"><R2BookingTimeline workspaceId={workspaceId} caseId={caseId} embedded /></DesktopConversationReview></V088AppShell>
}
