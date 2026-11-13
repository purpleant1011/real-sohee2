import { notFound } from 'next/navigation'
import { ExampleCustomersScreen } from '@/features/mobile-customers/example-customers-screen'

export const dynamic = 'force-dynamic'

/**
 * M17 고객 목록(ANI-1695) 폭 회귀 육안 검수용 개발 페이지.
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2/customers-list
 */
export default function CustomersListDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto w-full max-w-[420px] px-4 py-6">
        <ExampleCustomersScreen />
      </div>
    </main>
  )
}
