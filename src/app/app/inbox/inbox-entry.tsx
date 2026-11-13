'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Inbox } from '@/features/mobile-inbox/r2-inbox'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import InboxPage from './inbox-legacy'

/** 플래그 OFF(기본)·넓은 화면은 기존 화면 그대로(ANI-1770). */
export function InboxEntry() {
  const workspaceId = useWorkspaceId()
  return useMobileR2Active() ? <R2Inbox workspaceId={workspaceId} /> : <InboxPage />
}
