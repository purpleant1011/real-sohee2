'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { subscriptionOfferPolicy } from './subscription-offers'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import { cn } from '@/lib/utils'

interface BillingCancellationCardProps {
  onCancelRequest?: () => void
  className?: string
}

export function BillingCancellationCard({ className }: BillingCancellationCardProps) {
  return (
    <Card className={cn('w-full border-border bg-card', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          <h3>{subscriptionOfferPolicy.cancellation.label}</h3>
        </CardTitle>
        <CardDescription className="text-xs">
          {subscriptionOfferPolicy.cancellation.notice}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <details className="rounded-xl border border-border p-3 text-xs text-muted-foreground space-y-1">
          <summary className="font-medium text-foreground cursor-pointer select-none">
            해지 및 문의 방법 보기
          </summary>
          <div className="mt-2 pt-2 border-t space-y-1 text-xs">
            <p>{`신청 방법: 의견 보내기 또는 고객센터(${OPERATOR_INFO.phone}, ${OPERATOR_INFO.supportEmail})`}</p>
            <p>결제된 이용기간이 끝날 때까지 서비스를 정상 이용하실 수 있어요.</p>
          </div>
        </details>

        <div className="pt-1">
          <Link
            href="/refund"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            환불 안내
          </Link>
        </div>
      </CardContent>

      <CardFooter className="pt-2">
        <Button
          variant="outline"
          disabled
          className="w-full text-xs"
          aria-label="결제 준비 중"
        >
          결제 준비 중
        </Button>
      </CardFooter>
    </Card>
  )
}
