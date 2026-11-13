import { StatusPill } from '@/components/mobile-ui'
import { cn } from '@/lib/utils'
import type { ConsentView } from './consent-model'

const PILL: Record<ConsentView['status'], 'verified' | 'stopped' | 'review'> = {
  granted: 'verified',
  withdrawn: 'stopped',
  unknown: 'review',
}

/**
 * 고객 수신 동의 표시 — 공통 상태 알약(색 + 아이콘 + 글자)을 그대로 쓴다.
 * 판정은 `consent-model.ts` 가 맡고, 이 파일은 상태를 올리거나 바꾸지 않는다.
 * 확인 시점을 읽을 수 없으면 날짜를 만들지 않고 '알 수 없어요'로 둔다.
 */
export function ConsentStatusView({ consent, className }: Readonly<{
  consent: ConsentView
  className?: string
}>) {
  return (
    <section
      aria-label="수신 동의"
      data-consent-status={consent.status}
      className={cn('flex flex-col items-start gap-1.5', className)}
    >
      <StatusPill kind={PILL[consent.status]} label={consent.label} />
      <p className="text-[13px] leading-relaxed text-muted-foreground">{consent.detail}</p>
      <p className="text-xs leading-4 text-muted-foreground">
        {consent.checkedOn ? `${consent.checkedOn} 확인` : '확인 날짜를 알 수 없어요'}
        {consent.sourceLabel ? ` · ${consent.sourceLabel}` : ''}
      </p>
    </section>
  )
}
