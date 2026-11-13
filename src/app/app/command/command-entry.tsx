'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalWorkspaceContext } from '@/components/workspace/workspace-provider'
import { CommandCenterClient } from '@/components/v088/command/command-center-client'
import { R2Chat } from '@/features/mobile-chat/r2-chat'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

/**
 * M10 소희와 대화 진입점(ANI-1770).
 *
 * 정본 대화가 활성화된 가게는 화면 폭과 무관하게 같은 대화로 이동한다.
 * 미출시 가게만 기존 R2/지휘 화면 분기를 유지하며 별도 런타임을 중복 실행하지 않는다.
 */
export function CommandEntry() {
  const workspaceId = useWorkspaceId()
  const workspace = useOptionalWorkspaceContext()
  const mobile = useMobileR2Active()
  if (workspace?.conversationWorkbenchEnabled === true) return <CanonicalConversationEntry />
  return mobile
    ? <R2Chat workspaceId={workspaceId} />
    : <CommandCenterClient workspaceId={workspaceId} />
}

function CanonicalConversationEntry() {
  const router = useRouter()
  useEffect(() => { router.replace('/app/conversations') }, [router])
  return <p role="status">소희와의 대화를 열고 있어요.</p>
}
