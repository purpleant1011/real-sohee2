'use client'

import { Suspense } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { ContentHub } from '@/components/quick-post/content-hub'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { MobileHubView } from '@/features/mobile-hub/hub-view'
import { useWorkItems } from '@/features/mobile-hub/use-work-items'

/** 플래그 OFF(기본)·넓은 화면은 기존 콘텐츠 허브 그대로. ON 이면 M11 작업함. */
export function ContentEntry({ workspaceId }: { workspaceId: string }) {
  if (useMobileR2Active()) return <R2Content workspaceId={workspaceId} />

  return (
    <div className="w-full min-w-0">
      <Suspense fallback={null}>
        <NuqsAdapter>
          <ContentHub />
        </NuqsAdapter>
      </Suspense>
    </div>
  )
}

/** 조회 훅은 플래그가 켜진 화면에서만 호출한다. OFF 화면에 새 요청이 나가면 안 된다. */
function R2Content({ workspaceId }: { workspaceId: string }) {
  const source = useWorkItems(workspaceId)
  return (
    <MobileAppShell>
      <MobileHubView workspaceId={workspaceId} source={source} />
    </MobileAppShell>
  )
}
