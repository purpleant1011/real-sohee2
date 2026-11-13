import { notFound } from 'next/navigation'
import { MobileShellPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * W1 모바일 셸 육안 검수용 개발 페이지 (ANI-1662).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2
 */
export default function MobileR2DevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <MobileShellPreview />
    </main>
  )
}
