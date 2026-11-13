import { CheckCircle2, CircleDashed, Clock3, OctagonAlert, PauseCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 공통 상태 어휘(03 문서 D절). 예약확정/결제완료/게시완료는 provider 근거가 있을 때만 호출 측에서 `verified`를 쓴다. */
export const STATUS_PILL = {
  draft: { label: '초안', tone: 'quiet', Icon: CircleDashed },
  review: { label: '검토 필요', tone: 'warn', Icon: TriangleAlert },
  awaiting_approval: { label: '사용자 승인 대기', tone: 'warn', Icon: Clock3 },
  checking_external: { label: '외부 확인 중', tone: 'wait', Icon: Clock3 },
  verified: { label: '확인됨', tone: 'ok', Icon: CheckCircle2 },
  action_needed: { label: '조치 필요', tone: 'danger', Icon: OctagonAlert },
  stopped: { label: '중단됨', tone: 'quiet', Icon: PauseCircle },
} as const satisfies Record<string, { label: string; tone: string; Icon: LucideIcon }>

export type StatusPillKind = keyof typeof STATUS_PILL

/** 5자 초과 긴 라벨 자동 짧은 매핑 (기본 적용) */
export const AUTO_SHORT_STATUS_LABEL: Record<string, string> = {
  '게시 확인 전': '확인 전',
  '승인 완료 · 게시 확인 전': '확인 전',
  '상태 확인 필요': '확인 필요',
}

/** compact 변형 시 적용되는 핵심 단어 축약 매핑 */
export const COMPACT_STATUS_LABEL: Record<string, string> = {
  ...AUTO_SHORT_STATUS_LABEL,
  '사용자 승인 대기': '승인 대기',
  '외부 확인 중': '확인 중',
  '게시 확인 중': '확인 중',
  '이전에 확인한 내용': '이전 확인',
  '긴급 조치 필요': '조치 필요',
  '검토 필요': '검토 필요',
}

const TONE: Record<string, string> = {
  ok: 'bg-state-ok-soft text-state-ok border-[var(--state-ok-line)]',
  wait: 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]',
  warn: 'bg-state-warn-soft text-state-warn border-[var(--state-warn-line)]',
  danger: 'bg-state-danger-soft text-state-danger border-[var(--state-danger-line)]',
  quiet: 'bg-state-quiet-soft text-state-quiet border-[var(--state-quiet-line)]',
}

export interface StatusPillProps {
  kind: StatusPillKind
  label?: string
  compact?: boolean
  className?: string
}

/** 색 + 아이콘 + 글자 3중 신호. 좁은 폭에서도 세로 쪼개짐이 발생하지 않도록 shrink-0 whitespace-nowrap leading-none 고정. */
export function StatusPill({ kind, label, compact, className }: Readonly<StatusPillProps>) {
  const { label: base, tone, Icon } = STATUS_PILL[kind]
  const rawLabel = label ?? base
  const displayLabel = compact
    ? (COMPACT_STATUS_LABEL[rawLabel] ?? AUTO_SHORT_STATUS_LABEL[rawLabel] ?? rawLabel)
    : (AUTO_SHORT_STATUS_LABEL[rawLabel] ?? rawLabel)

  const isShortened = displayLabel !== rawLabel

  return (
    <span
      title={isShortened ? rawLabel : undefined}
      aria-label={isShortened ? rawLabel : undefined}
      className={cn(
        'inline-flex h-6 min-h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium leading-none whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {displayLabel}
    </span>
  )
}
