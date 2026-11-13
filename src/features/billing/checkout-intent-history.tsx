import type { CheckoutIntent } from './types'
import { StateView } from '@/components/mobile-ui/state-view'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface CheckoutIntentHistoryProps {
  intents: readonly CheckoutIntent[]
  title?: string
  className?: string
}

export function CheckoutIntentHistory({
  intents,
  title = '결제 내역',
  className,
}: Readonly<CheckoutIntentHistoryProps>) {
  return (
    <Card className={cn('w-full border-border bg-card', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          <h3 id="checkout-history-title">{title}</h3>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {intents.length === 0 ? (
          <StateView
            kind="confirmed_empty"
            title="아직 결제 내역이 없어요"
            description="결제가 완료되면 내역이 여기에 표시돼요."
            className="py-8"
          />
        ) : (
          <ol className="divide-y divide-border">
            {intents.map((intent) => {
              const isPending = intent.state === 'provider_pending'
              return (
                <li key={intent.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="font-semibold text-foreground">
                        {isPending ? '결제 기능 연결 대기' : intent.state}
                      </strong>
                      <Badge variant={isPending ? 'outline' : 'secondary'} className="text-[10px] px-1.5 py-0">
                        {isPending ? '대기 중' : intent.state}
                      </Badge>
                    </div>
                    {isPending && (
                      <p className="text-muted-foreground">
                        선택 저장 · 결제 및 활성화 대기
                      </p>
                    )}
                  </div>
                  <time dateTime={intent.createdAt} className="text-muted-foreground shrink-0 text-[11px]">
                    {intent.createdAt.slice(0, 10)}
                  </time>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
