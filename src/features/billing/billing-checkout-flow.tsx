'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { subscriptionOffers, subscriptionOfferPolicy } from './subscription-offers'
import { isBillingLive } from './billing-live'
import type { BillingPlanCode } from './types'
import { cn } from '@/lib/utils'
import { ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react'

export type CheckoutStep = 1 | 2 | 3

interface BillingCheckoutFlowProps {
  offerCode?: string
  planCode?: BillingPlanCode
  initialStep?: CheckoutStep
  nextBillingDate?: string
  vatNotice?: string
  onCancel?: () => void
  onComplete?: () => void
  className?: string
}

function resolveOffer(offerCode?: string, planCode?: BillingPlanCode) {
  if (offerCode) {
    const found = subscriptionOffers.find((o) => o.code === offerCode)
    if (found) return found
  }
  if (planCode) {
    if (planCode === 'growth') return subscriptionOffers[1]
    if (planCode === 'operations' || planCode === 'focus') return subscriptionOffers[2]
  }
  return subscriptionOffers[0]
}

export function BillingCheckoutFlow({
  offerCode,
  planCode,
  initialStep = 1,
  onCancel,
  onComplete,
  className,
}: BillingCheckoutFlowProps) {
  const [step, setStep] = useState<CheckoutStep>(initialStep)
  const [agreed, setAgreed] = useState(false)
  const live = isBillingLive()

  const offer = resolveOffer(offerCode, planCode)

  function handleFinalSubmit() {
    if (!live || !agreed) return
    onComplete?.()
  }

  const priceLabel = `월 ${offer.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 · 부가세 포함`

  return (
    <Card className={cn('w-full border-border bg-card', className)}>
      <CardHeader className="space-y-3 pb-4">
        {/* 단계 표시기 (Stepper) */}
        <div className="flex items-center justify-between border-b pb-3 text-xs font-medium">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-md px-2 py-1',
                step === 1 ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground'
              )}
            >
              1. 플랜 확인
            </span>
            <span className="text-muted-foreground">→</span>
            <span
              className={cn(
                'rounded-md px-2 py-1',
                step === 2 ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground'
              )}
            >
              2. 결제 수단
            </span>
            <span className="text-muted-foreground">→</span>
            <span
              className={cn(
                'rounded-md px-2 py-1',
                step === 3 ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground'
              )}
            >
              3. 확인
            </span>
          </div>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs text-muted-foreground">
              취소
            </Button>
          )}
        </div>

        <CardTitle className="text-lg font-bold">
          {step === 1 && '선택한 요금제 확인'}
          {step === 2 && '결제 수단 안내'}
          {step === 3 && '정기 구독 내용 확인'}
        </CardTitle>
        <CardDescription className="text-xs">
          {step === 1 && '매장에 맞는 플랜을 확인해 주세요.'}
          {step === 2 && '결제 정보는 안전하게 보호돼요.'}
          {step === 3 && '구독 내용과 약관을 확인해 주세요.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 1단계: 플랜 확인 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-foreground">{offer.name}</span>
                <Badge variant="secondary" className="text-xs">
                  AI 모델·기능 이용권
                </Badge>
              </div>
              <div className="text-lg font-bold text-primary">{priceLabel}</div>
              <p className="text-xs text-muted-foreground">
                세부 범위는 확정 후 안내
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              선택하신 플랜으로 매장 전담 업무를 준비합니다.
            </p>
          </div>
        )}

        {/* 2단계: 결제 수단 */}
        {step === 2 && (
          <div className="space-y-4">
            <Alert className="border-primary/20 bg-primary/5">
              <ShieldCheck className="size-4 text-primary" />
              <AlertTitle className="text-xs font-semibold">안전한 결제</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                카드·간편결제는 안전한 결제창에서 입력해요
              </AlertDescription>
            </Alert>

            <details className="rounded-xl border border-border p-3 text-xs text-muted-foreground space-y-1">
              <summary className="font-medium text-foreground cursor-pointer select-none">
                결제 안내 상세 보기
              </summary>
              <p className="mt-2 pt-2 border-t text-xs">
                정식 출시 시 신용카드 및 주요 간편결제를 안전한 전용 창에서 등록하실 수 있어요.
              </p>
            </details>

            <div className="pt-2">
              <Button
                variant="outline"
                disabled={!live}
                className="w-full text-xs"
                aria-label={live ? '결제 수단 등록' : '결제 준비 중'}
              >
                {live ? '결제 수단 등록' : '결제 준비 중'}
              </Button>
            </div>
          </div>
        )}

        {/* 3단계: 확인 */}
        {step === 3 && (
          <div className="space-y-4">
            {/* 구독 상세 정보 블록 */}
            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <h4 className="text-xs font-bold text-foreground">구독 내용 안내</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">신청 상품</span>
                <span className="text-right font-medium text-foreground">{offer.name}</span>
                <span className="text-muted-foreground">결제 금액</span>
                <span className="text-right font-bold text-foreground">{priceLabel}</span>
                <span className="text-muted-foreground">서비스 기간</span>
                <span className="text-right font-medium text-foreground">
                  {subscriptionOfferPolicy.servicePeriod.label}
                </span>
                <span className="text-muted-foreground">해지 기준</span>
                <span className="text-right font-medium text-foreground">
                  {subscriptionOfferPolicy.cancellation.label}
                </span>
                <span className="text-muted-foreground">자동갱신 조건</span>
                <span className="text-right font-medium text-foreground">확정 후 안내</span>
                <span className="text-muted-foreground">환불 세부</span>
                <span className="text-right font-medium text-foreground">확정 후 안내</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1 border-t leading-relaxed">
                {subscriptionOfferPolicy.cancellation.notice}
              </p>
            </div>

            {/* 동의 체크박스 (44px 클릭 영역) */}
            <label className="min-h-[44px] flex items-center gap-3 rounded-xl border border-border px-3 py-2 cursor-pointer select-none hover:bg-accent/40 transition-colors">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="size-4 shrink-0 rounded border-border accent-primary cursor-pointer"
                aria-label="이용약관과 환불 안내를 확인했어요"
              />
              <span className="text-xs font-medium text-foreground leading-snug">
                이용약관과 환불 안내를 확인했어요
              </span>
            </label>

            {/* 약관 및 환불 안내 링크 */}
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
                이용약관
              </Link>
              <Link href="/refund" className="underline underline-offset-4 hover:text-foreground">
                환불 안내
              </Link>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between border-t pt-4">
        {step > 1 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep((s) => (s - 1) as CheckoutStep)}
            className="text-xs"
          >
            <ArrowLeft className="size-3 mr-1" />
            이전
          </Button>
        ) : (
          <div />
        )}

        {step < 3 ? (
          <Button
            variant="default"
            size="sm"
            onClick={() => setStep((s) => (s + 1) as CheckoutStep)}
            className="text-xs"
          >
            다음 단계
            <ArrowRight className="size-3 ml-1" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            disabled={!live || !agreed}
            onClick={handleFinalSubmit}
            className="text-xs"
          >
            {live ? '구독 시작하기' : '결제 준비 중'}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
