'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui/state-view'
import { FirstPostEntry } from '@/features/mobile-firstpost/first-post-entry'
import { isFirstPostR2Enabled } from '@/features/mobile-firstpost/first-post-flow'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { WORK_NEW_FALLBACK_ROUTE } from './first-post-route-flag'

/**
 * `/app/work/new` 진입 게이트 (ANI-1767).
 *
 * 서버(`page.tsx`)가 이미 R2 플래그·allowlist 로 한 번 걸렀다. 여기서는 폭(≤767)과 첫 포스팅
 * 플래그를 더해 **모바일에서만** 3단계 흐름을 `MobileAppShell` 안에 그린다.
 * 그 밖(PC·태블릿)은 실제 글쓰기 시작 화면(`WORK_NEW_FALLBACK_ROUTE`: /app/content?studio=four-channel)으로
 * 전환하며, 이동 전/실패 시에도 안내 StateView와 명시적 이동 버튼을 노출한다.
 *
 * 셸을 여기서 감싸는 이유: `/app/layout.tsx` 는 provider 만 두고 셸은 진입점마다 마운트한다
 * (`work-preview-entry.tsx` 와 같은 방식). 그래야 PC 레이아웃에 5탭이 새지 않는다.
 */
export function FirstPostNewEntry({ workspaceId, restoreMissionId }: Readonly<{ workspaceId: string; restoreMissionId?: string }>) {
  const active = useMobileR2Active() && isFirstPostR2Enabled()
  const router = useRouter()

  useEffect(() => {
    if (!active) router.replace(WORK_NEW_FALLBACK_ROUTE)
  }, [active, router])

  if (!active) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <StateView
          kind="confirmed_empty"
          title="PC에서는 콘텐츠 허브에서 글을 만듭니다"
          description="넓은 화면에서는 4채널 글 만들기 스튜디오로 연결해 드려요."
          action={
            <Button asChild className="min-h-11 font-medium">
              <Link href={WORK_NEW_FALLBACK_ROUTE}>글 만들기 스튜디오로 이동</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <MobileAppShell>
      <FirstPostEntry workspaceId={workspaceId} restoreMissionId={restoreMissionId} />
    </MobileAppShell>
  )
}
