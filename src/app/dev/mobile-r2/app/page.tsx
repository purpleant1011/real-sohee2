import { notFound } from 'next/navigation'
import { MobileAppPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * W3 모바일 R2 5탭 앱 셸 육안 검수용 개발 페이지 (ANI-1664).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2/app
 */
export default function MobileR2AppDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  // 셸이 자체 <main>(스크롤 컨테이너)을 그리므로 여기서는 main 랜드마크를 겹치지 않는다.
  return (
    <div className="min-h-dvh bg-muted/40">
      <MobileAppPreview />
    </div>
  )
}
