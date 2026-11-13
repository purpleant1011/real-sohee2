import { notFound } from 'next/navigation'
import { ExampleBookingTimelineScreen } from '@/features/mobile-inbox/example-booking-timeline'

export const dynamic = 'force-dynamic'

/**
 * M14 예약 문의 타임라인 폭 회귀 육안 검수용 개발 페이지.
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2/booking-timeline
 */
export default function BookingTimelineDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <ExampleBookingTimelineScreen />
    </main>
  )
}
