'use client'

import type { ReactNode } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import type { ContentDetail } from '@/features/content/types'
import { WorkStudio } from '@/features/mobile-work/work-studio'
import type { WorkStudioContext } from '@/features/mobile-work/work-studio-model'

/** 모바일 표현에서는 작업 상세를 채널 미리보기·수정 이력·대화가 있는 '작업 스튜디오'로 연다. PC는 기존 상세 그대로다. */
export function WorkStudioEntry({ workspaceId, detail, context, conversationEnabled, children }: Readonly<{
  workspaceId: string
  detail: ContentDetail
  context: WorkStudioContext
  conversationEnabled: boolean
  children: ReactNode
}>) {
  const active = useMobileR2Active()
  if (!active) return <>{children}</>
  return (
    <MobileAppShell>
      <ShellScreen mode="DETAIL" title="작업">
        <WorkStudio workspaceId={workspaceId} detail={detail} context={context} conversationEnabled={conversationEnabled} />
      </ShellScreen>
    </MobileAppShell>
  )
}
