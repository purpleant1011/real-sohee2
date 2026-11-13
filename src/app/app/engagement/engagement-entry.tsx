'use client'

import { EngagementInbox } from '@/features/engagement/engagement-inbox'
import type { EngagementPolicy } from '@/features/engagement/types'
import { R2Inbox } from '@/features/mobile-inbox/r2-inbox'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'

/** 플래그 OFF(기본)·넓은 화면은 기존 소통함 그대로. ON 이면 R2 읽기 전용 목록. */
export function EngagementEntry({
  workspaceId,
  initialPolicies,
}: {
  workspaceId: string
  initialPolicies: {
    instagram?: EngagementPolicy | null
    threads?: EngagementPolicy | null
  }
}) {
  if (useMobileR2Active()) return <R2Inbox workspaceId={workspaceId} />

  return (
    <V088AppShell workspaceId={workspaceId}>
      <EngagementInbox workspaceId={workspaceId} initialPolicies={initialPolicies} />
    </V088AppShell>
  )
}
