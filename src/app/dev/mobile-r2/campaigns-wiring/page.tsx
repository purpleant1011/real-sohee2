import { notFound } from 'next/navigation'
import { CampaignsWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M18 캠페인 제안 승인 카드 하네스. 개발 환경 전용(운영 404). 로그인·실 API 호출 없음.
 *
 * /dev/mobile-r2/campaigns-wiring
 */
export default function CampaignsWiringDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="min-h-dvh bg-muted/40">
      <CampaignsWiringHarness />
    </main>
  )
}
