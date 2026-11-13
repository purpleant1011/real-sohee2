'use client'

import { UniversalAgentDock } from '@/components/agent-dock/universal-agent-dock'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { FIXTURE_WORKSPACE_ID, installFixtureFetch } from './fixture'

// 첫 렌더와 첫 fetch 보다 먼저 고정 응답을 건다. 서버 렌더에는 window 가 없어 건너뛴다.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  installFixtureFetch(window)
}

/**
 * 승인 카드 '승인 및 실행' 외부 쓰기 가드 확인용 개발 하네스(ANI-1725).
 * 실제 라우트에 마운트된 곳이 없는 UniversalAgentDock 을 고정 응답으로 띄운다.
 */
export function ApprovalCardHarness() {
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <p
        role="note"
        data-testid="approval-fixture-note"
        className="border-b border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        개발용 고정 응답 · 실제 서버 호출 없음. 개발 전용 확인 화면이라 운영에서는 열리지 않습니다.
      </p>
      <div className="flex min-h-0 flex-1 flex-col">
        <SurfaceContextProvider>
          <ProposalBusProvider workspaceId={FIXTURE_WORKSPACE_ID}>
            <UniversalAgentDock workspaceId={FIXTURE_WORKSPACE_ID} isOpen onClose={() => {}} />
          </ProposalBusProvider>
        </SurfaceContextProvider>
      </div>
    </main>
  )
}
