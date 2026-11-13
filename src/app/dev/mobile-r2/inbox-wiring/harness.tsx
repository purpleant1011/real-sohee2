'use client'

import { Suspense } from 'react'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { MobileR2Provider, useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileInboxView, inboxScreenConfig } from '@/features/mobile-inbox/inbox-view'
import InboxPage from '@/app/app/inbox/inbox-legacy'
import { INBOX_PREVIEW_SNAPSHOT, PREVIEW_WORKSPACE_ID } from './fixture'

/**
 * M13 소통함(`/app/inbox`) ON/OFF 비교 하네스(ANI-1766).
 *
 * 진입 분기는 실서비스와 같다 — `useMobileR2Active()`(= 서버 플래그 AND 767px 이하)가
 * 켜지면 R2 소통함, 아니면 기존 R1 화면. 다른 점은 R2 쪽의 서버 조회를 고정 스냅샷으로
 * 바꾼 것뿐이다(로그인·DB 조회 없음). 그래서 이 화면은 운영 증거가 아니라 배치·상태 육안 검수용이다.
 */
export function InboxWiringHarness({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <WorkspaceProvider
      value={{
        workspaceId: PREVIEW_WORKSPACE_ID,
        workspaceName: '예시 가게',
        workspaceKind: null,
        membershipRole: 'owner',
        actorId: 'dev-harness',
        resolutionSource: 'membership',
      }}
    >
      <MobileR2Provider enabled={enabled}>
        <main className="min-h-dvh bg-muted/40">
          <p className="bg-warning/10 px-3 py-1 text-center text-xs text-muted-foreground">
            예시 화면 · 실제 데이터가 아닙니다
          </p>
          <Suspense fallback={null}>
            <InboxBranch />
          </Suspense>
        </main>
      </MobileR2Provider>
    </WorkspaceProvider>
  )
}

function InboxBranch() {
  // 실서비스 진입점(`inbox-entry.tsx`)과 같은 게이트를 쓴다.
  return useMobileR2Active() ? <R2InboxPreview /> : <InboxPage />
}

/** `R2Inbox` 의 렌더 체인에서 서버 조회만 고정 스냅샷으로 대체한 것. */
function R2InboxPreview() {
  const { mode, title } = inboxScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        {/* 셸이 fixed 로 화면을 덮으므로, 예시라는 안내는 셸 안쪽에 둬야 보인다. */}
        <p className="mb-3 rounded-xl bg-muted/40 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          예시 화면이에요. 실제로 받은 문의가 아니에요.
        </p>
        <MobileInboxView
          snapshot={INBOX_PREVIEW_SNAPSHOT}
          onCopyDraft={() => {}}
          onOpenThread={() => {}}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
