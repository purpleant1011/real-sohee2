'use client'

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Credit } from '@/features/mobile-settings/r2-credit'
import type { CreditViewSnapshot } from '@/features/mobile-settings/credit-view'

/** 인증·권한이 거부되면 기존 화면도 원장을 그릴 수 없다. 지금까지와 같은 목적지로 보낸다. */
const REDIRECT_PATH = '/app/onboarding'

// 폭 판정(matchMedia)은 서버 렌더·첫 페인트에서 false 다. 그 값으로 보내면 모바일 R2 사용자를 잘못 보낸다.
// 그래서 브라우저에 붙은 뒤(=true)에만 이동을 판단한다.
const subscribeNever = () => () => {}
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}

/**
 * M25 요금·크레딧 진입점(ANI-1713, ANI-1714).
 * 서버가 이미 읽어 조립한 스냅샷을 그대로 넘긴다 — 이 컴포넌트는 다시 조회하지 않는다.
 * 플래그 OFF(기본)·넓은 화면은 기존 V088 화면 그대로다.
 */
export function CreditsEntry({ snapshot, legacy }: { snapshot: CreditViewSnapshot; legacy: ReactNode }) {
  const r2 = useMobileR2Active()
  const router = useRouter()
  const authDenied = snapshot.authFailure !== undefined
  const hydrated = useHydrated()

  useEffect(() => {
    if (!authDenied || !hydrated || r2) return
    router.replace(REDIRECT_PATH)
  }, [authDenied, hydrated, r2, router])

  if (r2) return <R2Credit snapshot={snapshot} />
  // 원장을 읽지 못한 상태에서 기존 화면을 그리면 '0 크레딧'처럼 보인다. 그러지 않고 보낸다.
  if (authDenied) return null
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          소희 서비스 이용 상태와 작업 실행 현황을 확인하는 화면입니다.
        </p>
      </div>
      {legacy}
    </div>
  )
}
