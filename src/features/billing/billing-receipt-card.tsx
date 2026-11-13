import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Receipt } from 'lucide-react'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import { cn } from '@/lib/utils'

export function BillingReceiptCard({ className }: Readonly<{ className?: string }>) {
  return (
    <Card className={cn('w-full border-border bg-card', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" />
          <CardTitle className="text-base font-semibold">
            <h3>영수증 및 증빙 안내</h3>
          </CardTitle>
        </div>
        <CardDescription className="text-xs">
          {`신청 방법은 의견 보내기 또는 고객센터(${OPERATOR_INFO.phone}, ${OPERATOR_INFO.supportEmail})`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <details className="rounded-xl border border-border p-3 text-xs text-muted-foreground space-y-1">
          <summary className="font-medium text-foreground cursor-pointer select-none">
            증빙 발급 상세 안내
          </summary>
          <div className="mt-2 pt-2 border-t space-y-1.5 text-xs">
            <p>세금계산서와 현금영수증 발행을 지원해요.</p>
            <p>결제일과 사업자등록증을 이메일로 보내주시면 빠르게 확인해 드려요.</p>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
