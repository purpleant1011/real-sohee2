'use client'

import { useState } from 'react'
import type { BillingPlanCode, CheckoutIntent } from './types'
import { BillingPlanCards } from './billing-plan-cards'
import { BillingCheckoutFlow } from './billing-checkout-flow'
import { CheckoutIntentHistory } from './checkout-intent-history'
import { BillingReceiptCard } from './billing-receipt-card'
import { BillingCancellationCard } from './billing-cancellation-card'
import { cn } from '@/lib/utils'

interface BillingViewProps {
  intents: readonly CheckoutIntent[]
  currentPlanCode?: BillingPlanCode
  vatNotice?: string
  className?: string
}

export function BillingView({
  intents,
  className,
}: Readonly<BillingViewProps>) {
  const [selectedOfferCode, setSelectedOfferCode] = useState<string>('STARTER_150K')

  return (
    <div className={cn('space-y-8 max-w-4xl w-full', className)}>
      {/* 1. 신규 구독 상품 비교·선택 화면 */}
      <BillingPlanCards
        selectedOfferCode={selectedOfferCode}
        onSelectOffer={(code) => setSelectedOfferCode(code)}
      />

      {/* 2. 결제 진행 골격 (3단계) */}
      <section aria-labelledby="checkout-flow-title" className="space-y-2">
        <h3 id="checkout-flow-title" className="sr-only">
          구독 신청 절차
        </h3>
        <BillingCheckoutFlow
          offerCode={selectedOfferCode}
        />
      </section>

      {/* 3. 결제 내역 영역 */}
      <CheckoutIntentHistory intents={intents} />

      {/* 4. 영수증 안내 및 해지/변경 카드 (PC 2열, 모바일 1열) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BillingReceiptCard />
        <BillingCancellationCard />
      </div>
    </div>
  )
}
