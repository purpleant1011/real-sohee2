'use client'

import { FreshnessLabel, StateChip } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { buildTimeline, type BookingInquiryDto, type BookingTimeline, type StepState } from './booking-timeline-model'
import type { BookingTimelineStateChip } from './booking-timeline-state'

export interface BookingTimelineProps {
  inquiry: BookingInquiryDto
  /** 다음 행동 1개. 승인/보내기 게이트 화면으로 넘기는 것이며 여기서 전송하지 않는다. */
  onNext?: (args: { inquiryId: string; kind: string }) => void
}

export interface BookingTimelineBodyProps {
  inquiryId: string
  timeline: BookingTimeline
  /** 고객 표시 이름. 대화를 확인하지 못했으면 null 이며 이름을 지어내지 않는다. */
  customerName: string | null
  /** 고객이 실제로 쓴 문의 원문. 확인하지 못했으면 null 이며 문구를 만들어 넣지 않는다. */
  inquiryText: string | null
  /** 5상태 칩. null·미지정이면 '확인된 전체'로 본다. */
  stateChip?: BookingTimelineStateChip | null
  /** 서버가 마지막으로 확인한 시각. 없으면 시각 줄을 그리지 않는다. */
  checkedAt?: string | null
  onNext?: (args: { inquiryId: string; kind: string }) => void
}

export function bookingTimelineScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '예약 문의' }
}

const STATE_LABEL: Record<StepState, string> = {
  done: '완료', current: '지금 할 일', waiting: '기다리는 중', todo: '아직', problem: '확인 필요',
}
const DOT: Record<StepState, string> = {
  done: 'bg-primary text-primary-foreground',
  current: 'border-2 border-primary bg-background text-primary',
  waiting: 'border-2 border-dashed border-muted-foreground bg-background text-muted-foreground',
  todo: 'border border-border bg-background text-muted-foreground',
  problem: 'border-2 border-destructive bg-background text-destructive',
}
const MARK: Record<StepState, string> = { done: '✓', current: '●', waiting: '…', todo: '', problem: '!' }

/**
 * 타임라인 본문. 계산된 `BookingTimeline` 을 그대로 그리므로, 근거가 어디서 왔든(예시 스냅샷/서버 계약)
 * 같은 규칙을 쓴다. 다음 행동을 넘길 곳이 없으면 버튼 대신 '할 일' 문장으로만 남긴다(죽은 버튼 금지).
 */
export function BookingTimelineBody({
  inquiryId,
  timeline: tl,
  customerName,
  inquiryText,
  stateChip = null,
  checkedAt = null,
  onNext,
}: BookingTimelineBodyProps) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{customerName ?? '예약 문의'}</h1>
        {inquiryText ? (
          <p className="whitespace-pre-wrap break-words text-base leading-6 text-muted-foreground">{inquiryText}</p>
        ) : null}
        {customerName === null ? (
          <p className="text-sm leading-5 text-muted-foreground">고객 이름과 원문은 대화에서 확인하지 못했어요.</p>
        ) : null}
        {stateChip ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StateChip kind={stateChip.kind} label={stateChip.label} />
          </div>
        ) : null}
      </header>

      <p role="status" className="rounded-xl bg-secondary px-3 py-2 text-base font-medium text-secondary-foreground">
        {tl.headline}
      </p>

      <ol aria-label="예약 진행" className="space-y-0">
        {tl.steps.map((s, i) => (
          <li key={s.id} className="flex gap-3" aria-current={s.state === 'current' ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${DOT[s.state]}`}>
                {MARK[s.state]}
              </span>
              {i < tl.steps.length - 1 ? <span aria-hidden className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 pb-5">
              <p className="text-base font-medium leading-7">
                {s.label} <span className="text-sm font-normal text-muted-foreground">· {STATE_LABEL[s.state]}</span>
              </p>
              {s.detail ? <p className="text-sm leading-5 text-muted-foreground">{s.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      {tl.next ? (
        onNext ? (
          <button
            type="button"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground"
            onClick={() => onNext({ inquiryId, kind: tl.next!.kind })}
          >
            {tl.next.label}
          </button>
        ) : (
          <p className="rounded-xl border border-border px-3 py-2 text-base font-medium">
            다음 할 일 · {tl.next.label}
          </p>
        )
      ) : null}

      <FreshnessLabel checkedAt={checkedAt} prefix="서버 확인" />
    </div>
  )
}

/** M14 예약 문의 타임라인. 확정 표현은 고객 수락+예약표 확인이 모두 있을 때만 나온다. */
export function MobileBookingTimeline({ inquiry, onNext }: BookingTimelineProps) {
  return (
    <BookingTimelineBody
      inquiryId={inquiry.id}
      timeline={buildTimeline(inquiry)}
      customerName={inquiry.customerName}
      inquiryText={inquiry.inquiryText}
      onNext={onNext}
    />
  )
}
