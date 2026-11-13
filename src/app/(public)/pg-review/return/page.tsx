import type { Metadata } from 'next'
import { PgReviewReturn } from '@/features/billing/pg-review-return'

export const metadata: Metadata = {
  title: '심사용 TEST 복귀 처리 | 소희 (SOHEE)',
  description:
    'PG사 심사용 TEST 카드등록 리디렉션 복귀 확인 페이지입니다. 실제 청구 및 구독 활성화는 진행되지 않습니다.',
  referrer: 'no-referrer',
  robots: {
    index: false,
    follow: false,
  },
}

export default function PgReviewReturnPage() {
  return <PgReviewReturn />
}
