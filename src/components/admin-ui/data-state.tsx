import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Inbox } from 'lucide-react'
import { Card } from '@/components/ui/card'

/**
 * Shared truthful-data primitives for the operator console.
 * Rule: a failed read is never shown as 0 or "없음". Use LoadErrorNotice for failures,
 * EmptyNotice only after a successful read that returned nothing, and MetricTile with value=null
 * when a number cannot be confirmed.
 */

export function LoadErrorNotice({ what, retryHref }: { what: string; retryHref?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-state-warn/40 bg-state-warn/10 px-4 py-3 text-sm font-medium text-state-warn">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>{what}을(를) 불러오지 못했어요. 표시된 값은 확인되지 않은 값이에요.</span>
      {retryHref ? (
        <Link href={retryHref} className="ml-auto inline-flex min-h-9 items-center rounded-lg border border-state-warn/40 px-3 text-xs font-semibold hover:bg-state-warn/15">
          다시 불러오기
        </Link>
      ) : null}
    </div>
  )
}

export function MfaRequiredNotice() {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-state-warn/40 bg-state-warn/10 px-4 py-3 text-sm font-medium text-state-warn">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>이 화면은 추가 인증(2단계)을 마친 뒤에 볼 수 있어요. 인증을 완료한 뒤 다시 열어 주세요.</span>
      <Link href="/auth/admin-setup" className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-state-warn/40 px-3 text-xs font-semibold hover:bg-state-warn/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        추가 인증하러 가기
      </Link>
    </div>
  )
}

export function EmptyNotice({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
      <Inbox className="size-8 stroke-[1.5] text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-xs">{description}</p> : null}
    </div>
  )
}

export type MetricTone = 'default' | 'good' | 'warn' | 'bad'

const TONE: Record<MetricTone, string> = {
  default: 'text-foreground',
  good: 'text-state-ok',
  warn: 'text-state-warn',
  bad: 'text-state-danger',
}

/** A number the operator can trust. value=null renders "확인할 수 없어요", never 0. */
export function MetricTile({
  label, value, hint, tone = 'default', href, footer,
}: {
  label: string
  value: string | number | null
  hint?: string
  tone?: MetricTone
  href?: string
  footer?: ReactNode
}) {
  const unknown = value === null || (typeof value === 'number' && !Number.isFinite(value))
  const body = (
    <Card className="h-full space-y-1.5 border-border/80 bg-card/80 p-4 shadow-xs transition-colors hover:border-border">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`text-2xl font-extrabold tracking-tight ${unknown ? 'text-base font-semibold text-muted-foreground' : TONE[tone]}`}>
        {unknown ? '확인할 수 없어요' : typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
      {footer}
    </Card>
  )
  return href ? <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{body}</Link> : body
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
