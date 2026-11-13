'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Campaigns } from '@/features/mobile-campaigns/r2-campaigns'
import { LEGACY_CAMPAIGNS_PATH } from './legacy-path'

const subscribe = () => () => {}
const clientHydrated = () => true
const serverHydrated = () => false

/** 하이드레이션 전에는 false. 첫 페인트에서 폭을 모르는 채로 이동하지 않기 위한 값이다. */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientHydrated, serverHydrated)
}

/**
 * 플래그 ON + 좁은 화면만 R2 제안 화면. 그 밖에는 기존 화면(내 소희 캠페인 탭)으로 보낸다(ANI-1771).
 * 첫 페인트는 폭을 모르므로, 하이드레이션이 끝나 판정이 확정된 뒤에만 이동한다.
 */
export function CampaignsEntry({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const active = useMobileR2Active()
  const hydrated = useHydrated()
  useEffect(() => {
    if (hydrated && !active) router.replace(LEGACY_CAMPAIGNS_PATH)
  }, [hydrated, active, router])
  return active ? <R2Campaigns workspaceId={workspaceId} /> : null
}
