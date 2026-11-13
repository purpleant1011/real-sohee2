'use client'

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { subscriptionOffers } from './subscription-offers'
import { isBillingLive } from './billing-live'
import type { BillingPlanCode } from './types'
import { cn } from '@/lib/utils'

export const PLAN_ONE_LINE_DESCRIPTIONS: Record<BillingPlanCode, string> = {
  starter: '기본 기능을 무료로 체험해요',
  growth: '매장 홍보를 꾸준히 시작해요',
  operations: '다채널 운영과 성과를 집중 관리해요',
  focus: '다점포와 브랜드 전담 관리를 지원해요',
}

interface BillingPlanCardsProps {
  selectedOfferCode?: string
  onSelectOffer?: (code: string) => void
  currentPlanCode?: BillingPlanCode
  selectedPlanCode?: BillingPlanCode
  onSelectPlan?: (code: BillingPlanCode) => void
  className?: string
}

export function BillingPlanCards({
  selectedOfferCode,
  onSelectOffer,
  selectedPlanCode,
  onSelectPlan,
  className,
}: BillingPlanCardsProps) {
  const live = isBillingLive()
  const activeSelectedCode = selectedOfferCode ?? selectedPlanCode ?? 'STARTER_150K'

  function handleSelect(code: string) {
    onSelectOffer?.(code)
    onSelectPlan?.(code as BillingPlanCode)
  }

  return (
    <section aria-labelledby="plan-comparison-title" className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 id="plan-comparison-title" className="text-base font-semibold text-foreground">
          요금제 비교
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {subscriptionOffers.map((offer) => {
          const isSelected = offer.code === activeSelectedCode

          return (
            <Card
              key={offer.code}
              className={cn(
                'flex flex-col justify-between transition-colors border',
                isSelected
                  ? 'border-primary ring-2 ring-primary/20 bg-accent/30'
                  : 'border-border/70 hover:border-border'
              )}
            >
              <CardHeader className="space-y-2.5">
                <div className="flex flex-col items-start gap-1.5 min-h-[48px]">
                  <Badge variant="secondary" className="text-xs font-medium">
                    AI 모델·기능 이용권
                  </Badge>
                  <CardTitle className="text-base font-bold text-foreground">
                    <h4>{offer.name}</h4>
                  </CardTitle>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  세부 범위는 확정 후 안내
                </p>
              </CardHeader>

              <CardContent>
                <div className="text-xl font-bold tracking-tight text-foreground">
                  {`월 ${offer.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 · 부가세 포함`}
                </div>
              </CardContent>

              <CardFooter className="pt-2">
                {!live ? (
                  <Button
                    variant="outline"
                    disabled
                    className="w-full text-xs"
                    aria-label="결제 준비 중"
                  >
                    결제 준비 중
                  </Button>
                ) : isSelected ? (
                  <Button
                    variant="default"
                    className="w-full text-xs"
                    onClick={() => handleSelect(offer.code)}
                    aria-label={`${offer.name} 선택됨`}
                  >
                    선택됨
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => handleSelect(offer.code)}
                    aria-label={`${offer.name} 선택`}
                  >
                    {`${offer.name} 선택`}
                  </Button>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
