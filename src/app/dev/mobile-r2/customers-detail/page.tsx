import { notFound } from 'next/navigation'
import { ExampleCustomerDetailScreen } from '@/features/mobile-customers/example-customers-screen'

export const dynamic = 'force-dynamic'

/**
 * M17b 고객 상세(ANI-1695) 폭 회귀 육안 검수용 개발 페이지.
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2/customers-detail
 */
export default function CustomerDetailDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto w-full max-w-[420px] px-4 py-6">
        <ExampleCustomerDetailScreen customerId="preview-customer-1" />
      </div>
    </main>
  )
}
