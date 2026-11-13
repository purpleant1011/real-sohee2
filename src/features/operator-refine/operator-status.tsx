import React, { type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

type State = 'success' | 'warning' | 'critical' | 'neutral' | 'unknown'

export function OperatorStatusTag({ label, state }: Readonly<{ label: string; state: State }>) {
  const variant = state === 'success' ? 'success' : state === 'warning' ? 'warning' : state === 'critical' ? 'destructive' : 'outline'
  return <Badge variant={variant} className="text-[10px] font-medium" data-operator-state={state}>{label}</Badge>
}

export function OperatorSourceState({ state }: Readonly<{ state: 'fresh' | 'stale' | 'unavailable' | 'unknown' }>) {
  const labels = {
    fresh: '최근 확인',
    stale: '자료 갱신 필요',
    unavailable: '자료 연결 실패',
    unknown: '자료 확인 전',
  } as const
  const tone = state === 'fresh' ? 'success' : state === 'stale' ? 'warning' : state === 'unavailable' ? 'critical' : 'unknown'
  return <OperatorStatusTag state={tone} label={labels[state]} />
}

export function OperatorEmpty({
  action,
  description,
  title,
}: Readonly<{ action?: ReactNode; description: string; title: string }>) {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed rounded-lg bg-muted/20">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
