'use client'

import { useEffect, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { V085MarketingHome } from '@/features/marketing/v085-marketing-home'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { MobileLandingView } from '@/features/mobile-landing/landing-view'
import { LANDING_EXAMPLES, type LandingViewSnapshot } from '@/features/mobile-landing/landing-model'

/**
 * [ANI-1672] M01 공개 첫 화면(`/`) 진입.
 *
 * 플래그 OFF(기본)·넓은 화면은 기존 V0.85 랜딩을 그대로 쓴다 — 기존 화면이 폴백이다.
 * 플래그 ON + 좁은 화면에서만 모바일 랜딩을 그린다.
 *
 * 예시는 서버 조회가 아니라 제품 설명용 정적 문구라 `checkedAt` 은 null 이다(확인 시각을 지어내지 않는다).
 * CTA 는 기존 라우트(`/signup`, `/login`, `/terms`, `/privacy`)로만 가고 가입 처리 호출은 하지 않는다.
 */
const LANDING_SNAPSHOT: LandingViewSnapshot = {
  loadState: 'ready',
  examples: LANDING_EXAMPLES,
  checkedAt: null,
}

export function PublicHomeEntry() {
  const landing = useMobileR2Active()
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    if (!landing) return
    try {
      createBrowserSupabaseClient().auth.getSession().then(({ data }) => setSignedIn(Boolean(data?.session))).catch(() => {})
    } catch {
      // 세션을 확인하지 못하면 가입 CTA 를 그대로 둔다.
    }
  }, [landing])
  return landing ? <MobileLandingView snapshot={LANDING_SNAPSHOT} signedIn={signedIn} /> : <V085MarketingHome />
}
