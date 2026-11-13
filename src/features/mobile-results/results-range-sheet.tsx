'use client'

import { useId, useState, type FormEvent } from 'react'
import { MobileSheet } from '@/components/mobile-ui'
import {
  MAX_REPORTING_RANGE_DAYS,
  resultsRangeIssue,
  type ResultsRange,
  type ResultsRangeIssue,
} from './results-period'

const DAY_MS = 24 * 60 * 60 * 1000

/** 화면에 그리는 사유 문구. 판정 코드는 `resultsRangeIssue` 하나에서만 나온다(서버와 같은 규칙). */
const ISSUE_COPY: Record<ResultsRangeIssue, string> = {
  REVERSED: '종료일은 시작일보다 빠를 수 없어요',
  TOO_LONG: `최대 ${MAX_REPORTING_RANGE_DAYS}일까지 볼 수 있어요`,
  FUTURE: '오늘 이후는 볼 수 없어요',
  INVALID: '날짜를 다시 확인해 주세요',
}

/** 오늘(UTC)을 포함한 최근 7일. 값이 없을 때 시트가 채우는 기본 구간이다. */
function defaultResultsRange(now: Date = new Date()): ResultsRange {
  const end = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - 6 * DAY_MS).toISOString().slice(0, 10)
  return { start, end }
}

export interface ResultsRangeSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 현재 적용 중인 구간. 없으면 최근 7일(오늘 포함, UTC)을 기본값으로 채운다. */
  value: ResultsRange | null
  onConfirm: (range: ResultsRange) => void
}

/**
 * 기간 직접 선택 바텀시트(ANI-1782).
 *
 * 판정·문구·버튼 상태를 모두 `resultsRangeIssue` 에서 파생한다. 확인을 누르면 서버가
 * 거절할 수 있는 값을 화면이 미리 줄이거나 바꾸지 않는다 — 그대로 넘기고, 400 은 목록 화면이
 * 사유 한 줄로 보여준다.
 */
export function ResultsRangeSheet({ open, onOpenChange, value, onConfirm }: ResultsRangeSheetProps) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="기간 직접 선택"
      description="시작일과 종료일을 골라 주세요. 하루 단위예요."
    >
      {/* Radix 는 닫을 때 내용을 내리므로, 열 때마다 지금 적용 중인 값(없으면 최근 7일)으로 새로 시작한다. */}
      <RangeForm
        initial={value ?? defaultResultsRange()}
        onCancel={() => onOpenChange(false)}
        onConfirm={(range) => {
          onConfirm(range)
          onOpenChange(false)
        }}
      />
    </MobileSheet>
  )
}

function RangeForm({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: ResultsRange
  onCancel: () => void
  onConfirm: (range: ResultsRange) => void
}) {
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const messageId = useId()

  // 빈 칸은 '잘못된 날짜'가 아니라 아직 고르지 않은 상태다. 사유 대신 버튼만 잠근다.
  const missing = !start || !end
  const issue = missing ? null : resultsRangeIssue({ start, end })
  const canConfirm = !missing && issue === null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canConfirm) return
    onConfirm({ start, end })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <div className="grid gap-1.5">
          <label htmlFor={`${messageId}-start`} className="text-sm font-medium text-foreground">시작일</label>
          <input
            id={`${messageId}-start`}
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            aria-describedby={messageId}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${messageId}-end`} className="text-sm font-medium text-foreground">종료일</label>
          <input
            id={`${messageId}-end`}
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            aria-describedby={messageId}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
      </div>

      {/* 항상 같은 요소를 두어 aria-describedby 가 가리키는 대상이 사라지지 않게 한다. */}
      <p id={messageId} role="status" className="min-h-5 text-sm leading-relaxed text-destructive">
        {issue ? ISSUE_COPY[issue] : ''}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="submit"
          disabled={!canConfirm}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:bg-muted disabled:text-muted-foreground"
        >
          이 기간 보기
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          취소
        </button>
      </div>
    </form>
  )
}
