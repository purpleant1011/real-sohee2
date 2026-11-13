'use client'

import { useId, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { subscriptionOffers, subscriptionOfferPolicy } from './subscription-offers'

export interface ProofOfWorkItem {
  id: string
  title: string
  channel: string
  verifiedAt: string
  energyCost: number
}

interface ProofOfWorkPaywallModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  businessName?: string
  /** 기존 호출부와의 타입 호환용. 신규 구독의 지급량·잔액으로 표시하지 않는다. */
  energySpent?: number
  energyCapacity?: number
  recentProofs?: ProofOfWorkItem[]
  onSelectPlan?: (planCode: string) => Promise<void>
}

export function ProofOfWorkPaywallModal({
  isOpen,
  onClose,
  businessName = '사장님 매장',
  recentProofs = [],
}: ProofOfWorkPaywallModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<string>('GROWTH_300K')
  const groupName = useId()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }} title="소희 월 구독 안내">
      <div className="space-y-6">
        <p>{businessName}에 필요한 월 구독 상품을 살펴보세요.</p>
        <p>{subscriptionOfferPolicy.notice}</p>
        {recentProofs.length > 0 && (
          <section aria-label="전달된 업무 기록">
            <h3>업무 기록</h3>
            <ul>{recentProofs.map((proof) => (
              <li key={proof.id}><span>{proof.title}</span> · {proof.channel} · {proof.verifiedAt}</li>
            ))}</ul>
          </section>
        )}
        <fieldset className="space-y-3">
          <legend>검토 중인 월 구독 상품</legend>
          <p>아래는 VAT 포함 월 결제금액입니다. 이용 조건과 PG 연동 준비가 끝난 후 구매할 수 있습니다.</p>
          {subscriptionOffers.map((plan) => (
            <label key={plan.code} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-4">
              <input type="radio" name={groupName} value={plan.code} checked={selectedPlan === plan.code} onChange={() => setSelectedPlan(plan.code)} />
              <span><strong>{plan.name}</strong><br /><span>₩{plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}</span> / 월 · <span>VAT 포함</span></span>
            </label>
          ))}
        </fieldset>
        <p>서비스 제공기간: {subscriptionOfferPolicy.servicePeriod.label}</p>
        <p>{subscriptionOfferPolicy.servicePeriod.boundaryNotice}</p>
        <p>해지 기준: {subscriptionOfferPolicy.cancellation.label}</p>
        <p>{subscriptionOfferPolicy.cancellation.notice}</p>
        <p>{subscriptionOfferPolicy.cancellation.refundNotice}</p>
        <p>{subscriptionOfferPolicy.purchaseNotice}</p>
        <p>{subscriptionOfferPolicy.creditNotice}</p>
        <p><a href="/pricing">요금 안내</a> · <a href="/terms">이용약관</a> · <a href="/refund">해지·환불 안내</a></p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border px-5">나중에 하기</button>
          <button type="button" disabled className="min-h-12 rounded-xl border px-5 opacity-60">결제 준비 중</button>
        </div>
      </div>
    </Dialog>
  )
}
