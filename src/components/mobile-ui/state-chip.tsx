import { Clock3, CircleAlert, Loader, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StateKind } from './state-view'

/** 5상태(loading/partial/stale/error/offline)별 정직한 칩. 어떤 상태도 '확인됨'·'완료' 같은 성공 문구를 쓰지 않는다. */
export type StateChipKind = Extract<StateKind, 'loading' | 'partial' | 'stale' | 'error' | 'offline'>

export const STATE_CHIP = {
  loading: { label: '확인하는 중', tone: 'wait', Icon: Loader },
  partial: { label: '일부만 확인', tone: 'warn', Icon: CircleAlert },
  stale: { label: '이전에 확인한 내용', tone: 'quiet', Icon: Clock3 },
  error: { label: '확인 실패', tone: 'danger', Icon: TriangleAlert },
  offline: { label: '오프라인', tone: 'quiet', Icon: WifiOff },
} as const satisfies Record<StateChipKind, { label: string; tone: string; Icon: LucideIcon }>

const TONE: Record<string, string> = {
  wait: 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]',
  warn: 'bg-state-warn-soft text-state-warn border-[var(--state-warn-line)]',
  danger: 'bg-state-danger-soft text-state-danger border-[var(--state-danger-line)]',
  quiet: 'bg-state-quiet-soft text-state-quiet border-[var(--state-quiet-line)]',
}

/** 색 + 아이콘 + 글자 3중 신호. 좁은 폭에서도 세로 쪼개짐이 발생하지 않도록 shrink-0 whitespace-nowrap leading-none 고정. */
export function StateChip({ kind, label, className }: Readonly<{ kind: StateChipKind; label?: string; className?: string }>) {
  const { label: base, tone, Icon } = STATE_CHIP[kind]
  return (
    <span
      data-state-chip={kind}
      className={cn(
        'inline-flex h-6 min-h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium leading-none whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', kind === 'loading' && 'motion-safe:animate-spin')} />
      {label ?? base}
    </span>
  )
}
