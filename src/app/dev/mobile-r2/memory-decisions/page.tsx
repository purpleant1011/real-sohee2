import { notFound } from 'next/navigation'
import { MemoryDecisionsPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * M22 가게 기억 승인·거절(ANI-1709) 육안 검수용 개발 페이지.
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 * 실제 후보·확정 상태는 서버 응답에서만 오고, 이 화면은 예시 데이터다.
 *
 * /dev/mobile-r2/memory-decisions
 */
export default function MemoryDecisionsDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <MemoryDecisionsPreview />
    </main>
  )
}
