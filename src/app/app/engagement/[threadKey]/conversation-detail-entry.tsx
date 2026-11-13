'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2ConversationDetail } from '@/features/mobile-inbox/r2-conversation-detail'
import { safeDecodeThreadKey } from '@/features/mobile-inbox/detail-model'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { DesktopConversationReview } from '@/features/engagement/desktop-conversation-review'

/** 표현만 나누고 같은 workspace/thread 원장·서버 권한·승인 게이트를 공유한다. */
export function ConversationDetailEntry({ threadKey }: { threadKey: string }) {
  const workspaceId = useWorkspaceId()
  const active = useMobileR2Active()
  const sourceKey = safeDecodeThreadKey(threadKey)
  if (active) return <R2ConversationDetail workspaceId={workspaceId} threadKey={sourceKey} />
  return <V088AppShell workspaceId={workspaceId}><DesktopConversationReview><R2ConversationDetail workspaceId={workspaceId} threadKey={sourceKey} embedded /></DesktopConversationReview></V088AppShell>
}
