import type { Metadata } from 'next'
import { PgReviewCheckout } from '@/features/billing/pg-review-checkout'

export const metadata: Metadata = {
  title: '심사용 TEST 카드등록창 확인 | 소희 (SOHEE)',
  description:
    'PG사 심사용 TEST 카드등록창 검토 페이지입니다. 실제 청구 및 구독 활성화는 진행되지 않으며 실출금 행위는 금지되어 있습니다.',
  referrer: 'no-referrer',
  robots: {
    index: false,
    follow: false,
  },
}

export default function PgReviewPage() {
  return <PgReviewCheckout />
}
