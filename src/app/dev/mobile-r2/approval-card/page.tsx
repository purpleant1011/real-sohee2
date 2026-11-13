import { notFound } from 'next/navigation'
import { ApprovalCardHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * 승인 카드 '승인 및 실행' 가드 검수용 개발 전용 fixture (/dev/mobile-r2/approval-card).
 * 운영(production)에서는 404 다. 로그인·서버 조회·provider 호출 없음.
 */
export default async function ApprovalCardDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ApprovalCardHarness />
}
