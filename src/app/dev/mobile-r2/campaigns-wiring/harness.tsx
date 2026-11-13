'use client'

import { R2Campaigns } from '@/features/mobile-campaigns/r2-campaigns'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { FIXTURE_WORKSPACE_ID, createCampaignFixtureFetch } from './fixture'

type InstallGlobal = typeof globalThis & { __soheeCampaignFixtureFetch?: boolean }

/**
 * 실컴포넌트가 마운트되기 전에 fetch 대역을 설치한다. 모듈 평가 시점에 한 번만 설치하므로
 * 컴포넌트 이펙트 순서에 기대지 않고, StrictMode 재마운트에도 대역이 겹쳐 쌓이지 않는다.
 * 서버 렌더에서는 window 가 없어 아무 일도 하지 않는다.
 */
function installFixtureFetchOnce(): void {
  if (typeof window === 'undefined') return
  const scope = globalThis as InstallGlobal
  if (scope.__soheeCampaignFixtureFetch) return
  scope.fetch = createCampaignFixtureFetch(scope.fetch.bind(globalThis))
  scope.__soheeCampaignFixtureFetch = true
}

installFixtureFetchOnce()

/**
 * M18 제안 승인 카드 육안 검수용 하네스(개발 전용).
 *
 * 실서비스 컴포넌트(`R2Campaigns`)를 그대로 마운트하되, 로그인과 실서버 호출 없이
 * 고정 픽스처 응답을 쓴다. 실제 매장 데이터가 아니므로 화면 배치·문구 노출 시점 확인용이다.
 */
export function CampaignsWiringHarness() {
  return (
    <MobileR2Provider enabled>
      <R2Campaigns workspaceId={FIXTURE_WORKSPACE_ID} />
    </MobileR2Provider>
  )
}
