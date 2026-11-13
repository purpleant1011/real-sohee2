import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { resolveHostPresentation } from '@/features/mobile-shell/host-presentation'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { resolveMobileR2LandingEnabled } from '@/features/mobile-shell/r2-flag'
import { PublicShell } from './public-shell'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers()
  const { forceMobile, forcePc, initialMobile } = resolveHostPresentation(requestHeaders.get('host'), requestHeaders.get('user-agent'))

  // [ANI-1672] 공개 첫 화면 R2 랜딩 플래그. m.example.com 접속 시에는 항상 모바일 랜딩 활성화
  const landingEnabled = forceMobile || resolveMobileR2LandingEnabled(process.env.MOBILE_R2_LANDING_ENABLED)
  return (
    <MobileR2Provider initialMobile={initialMobile} forceMobile={forceMobile} forcePc={forcePc} enabled={landingEnabled}>
      <PublicShell>{children}</PublicShell>
    </MobileR2Provider>
  )
}

