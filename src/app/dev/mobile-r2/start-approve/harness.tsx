'use client'

import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { R2WorkApprove } from '@/features/mobile-approvals/r2-work-approve'
import { FirstPostEntry } from '@/features/mobile-firstpost/first-post-entry'
import { MobileAppShell } from '@/features/mobile-shell'
import { MobileR2Provider, useMobileR2Active } from '@/features/mobile-shell/r2-gate'

/**
 * M06 첫 포스팅 진입 가드 + M07 게시 전 최종 확인 육안 검수용(ANI-1680).
 *
 * 서버 라우트와 같은 컴포넌트(`FirstPostEntry` / `R2WorkApprove` + `MobileAppShell`)를
 * 그대로 마운트하되, 로그인·서버 조회 없이 플래그와 고정 스냅샷만 바꿔 끼운다.
 * 실제 서버 스냅샷이 아니므로 운영 증거가 아니라 화면 배치·ON/OFF 분기 확인용이다.
 *
 * 플래그가 꺼져 있거나 넓은 화면일 때 실제 앱은 R1(기존 작업 상세)으로 돌아가고,
 * `/start/preview-r2` 는 404 다. 로그인 없는 하네스에서는 그 이동 대상이 열리지 않으므로
 * 같은 분기를 자리표시자(`data-legacy-*`)로 보여 준다 — R2 화면이 새로 그려지지 않는다는 사실만 본다.
 */
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const CONTENT_ID = 'dev-content'

const SNAPSHOT: ApprovalPreviewSnapshot = {
  workspaceId: WORKSPACE_ID,
  contentId: CONTENT_ID,
  versionId: 'dev-version-3',
  versionNumber: 3,
  fingerprint: '0'.repeat(64),
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: 'dev-connection', label: '인스타그램 @sohee', status: 'connected' },
  caption: '',
  hashtags: [],
  disclosure: '',
  text: '이번 주 신메뉴를 소개합니다.\n\n#신메뉴 #오픈',
  media: [],
  issues: [],
}

function LegacyNotice({ reason }: Readonly<{ reason: string }>) {
  return (
    <div data-legacy-work-approve className="space-y-1 p-6 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">기존 작업 상세 화면(R1)</p>
      <p>{reason}</p>
    </div>
  )
}

function ApproveFixture() {
  const active = useMobileR2Active()
  if (!active) {
    return <LegacyNotice reason="플래그 OFF 또는 768px 초과 — 실제 진입점은 기존 작업 상세로 replace 하고 R2 승인 화면을 그리지 않는다." />
  }
  return (
    <MobileAppShell>
      <R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={SNAPSHOT} />
    </MobileAppShell>
  )
}

function FirstPostFixture({ r2Enabled }: Readonly<{ r2Enabled: boolean }>) {
  if (!r2Enabled) {
    return <LegacyNotice reason="플래그 OFF — 실제 /start/preview-r2 는 notFound() 로 404 이고 워크스페이스도 조회하지 않는다." />
  }
  return <FirstPostEntry workspaceId={WORKSPACE_ID} />
}

export function StartApproveHarness({
  r2Enabled,
  screen,
}: Readonly<{ r2Enabled: boolean; screen: 'firstpost' | 'approve' }>) {
  return (
    <MobileR2Provider enabled={r2Enabled}>
      <main className="min-h-dvh bg-muted/40">
        {screen === 'firstpost' ? <FirstPostFixture r2Enabled={r2Enabled} /> : <ApproveFixture />}
      </main>
    </MobileR2Provider>
  )
}
