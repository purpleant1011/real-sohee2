'use client'

import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { TodayHome } from '@/components/home-today/today-home'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

/** 오늘 홈 R2 배선 육안 검수용(ANI-1770). 플래그 ON/OFF 를 쿼리로 바꿔 같은 TodayHome 을 렌더한다. */
export function TodayWiringHarness({ enabled }: { enabled: boolean }) {
  return (
    <WorkspaceProvider value={{ workspaceId: '00000000-0000-4000-8000-000000000001', workspaceName: '예시 가게', workspaceKind: null, membershipRole: 'owner', actorId: 'dev-harness', resolutionSource: 'membership' }}>
      <MobileR2Provider enabled={enabled}>
        <TodayHome workspaceId="00000000-0000-4000-8000-000000000001" />
      </MobileR2Provider>
    </WorkspaceProvider>
  )
}
