'use client'

import type { ReactNode } from 'react'
import { FreshnessLabel, StateChip, StateView } from '@/components/mobile-ui'
import {
  EVIDENCE_RECORD_ROW_MIN_HEIGHT,
  evidenceRecordOccurredLabel,
  type EvidenceRecordListSnapshot,
} from './evidence-record-list-state'

/**
 * M20 근거 기록 목록 화면(ANI-1783 2단계).
 *
 * 화면은 조회를 모른다. 스냅샷에 담긴 "서버가 확인한 사실"만 그리고, 확인하지 못한 상태에서는
 * 목록을 그리지 않는다. 기록 id·UUID·내부 경로는 스냅샷에 없으므로 여기에도 없다.
 */
export function EvidenceRecordListView({
  snapshot,
  onRetry,
}: Readonly<{ snapshot: EvidenceRecordListSnapshot; onRetry?: () => void }>) {
  const retry = onRetry ? (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-muted px-4 text-sm font-medium text-foreground"
    >
      다시 확인하기
    </button>
  ) : null

  return (
    // 셸의 스크롤 영역 안에서 키보드로 내려갈 수 있는 포커스 지점을 둔다(axe `scrollable-region-focusable`).
    <div
      role="region"
      aria-label="근거 기록 내용"
      tabIndex={0}
      className="mx-auto w-full max-w-2xl space-y-4 rounded-2xl pb-6 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <header className="space-y-1 pt-1">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{snapshot.metricLabel} 근거 기록</h1>
        <p className="text-base leading-6 text-muted-foreground">
          이 숫자를 뒷받침하는 기록을 종류와 시각으로 보여드려요.
        </p>
        {snapshot.chip ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StateChip kind={snapshot.chip.kind} label={snapshot.chip.label} />
          </div>
        ) : null}
      </header>

      <Body snapshot={snapshot} retry={retry} />
    </div>
  )
}

function Body({ snapshot, retry }: Readonly<{ snapshot: EvidenceRecordListSnapshot; retry: ReactNode }>) {
  if (snapshot.kind === 'loading') return <StateView kind="loading" skeleton="list" skeletonRows={4} />

  if (snapshot.kind === 'offline') return <StateView kind="offline" action={retry} />
  if (snapshot.kind === 'error') return <StateView kind="error" action={retry} />
  if (snapshot.kind === 'unauthorized') {
    // 세션 만료와 권한 없음은 다른 사건이다. 문구를 나눈다(설계 §5.1).
    return snapshot.unauthorizedReason === 'session'
      ? <StateView kind="session_expired" />
      : <StateView kind="unauthorized" />
  }
  if (snapshot.kind === 'missing') {
    return (
      <StateView
        kind="confirmed_empty"
        title="그런 기록을 찾지 못했어요"
        description="주소가 바뀌었거나 없는 기록이에요. 성과 화면에서 다시 들어와 주세요."
      />
    )
  }
  if (snapshot.kind === 'confirmed_empty') {
    return <StateView kind="confirmed_empty" title="이 기간에 확인된 기록이 없어요" description={snapshot.notice ?? undefined} />
  }
  if (snapshot.stale) {
    return <StateView kind="stale" description={snapshot.notice ?? undefined} checkedAt={snapshot.checkedAt} action={retry} />
  }

  if (snapshot.showRecords) {
    return (
      <div className="space-y-3">
        <p role="status" aria-live="polite" className="text-base leading-7">
          {snapshot.countText}
        </p>
        <ul aria-label="근거 기록 목록" className="divide-y divide-border rounded-2xl border border-border">
          {snapshot.records.map((record, index) => {
            const occurred = evidenceRecordOccurredLabel(record.occurredAt)
            return (
              // 기록 id 를 받지 않으므로(2안) 순서가 곧 식별자다. 목록은 정렬된 최근 순이다.
              <li
                key={`${record.occurredAt}-${record.kind}-${index}`}
                className="flex flex-col justify-center gap-0.5 px-3 py-2"
                style={{ minHeight: EVIDENCE_RECORD_ROW_MIN_HEIGHT }}
              >
                <span className="break-words text-sm font-medium">{record.summary}</span>
                <span className="break-words text-[13px] leading-5 text-muted-foreground">
                  {record.kindLabel}
                  {occurred ? ` · ${occurred}` : null}
                </span>
              </li>
            )
          })}
        </ul>
        {snapshot.omittedText ? (
          <p role="status" className="text-[13px] leading-5 text-muted-foreground">
            {snapshot.omittedText}
          </p>
        ) : null}
        {snapshot.checkedAtNotice ? (
          <p role="status" className="text-[13px] leading-5 text-muted-foreground">
            {snapshot.checkedAtNotice}
          </p>
        ) : null}
        <FreshnessLabel checkedAt={snapshot.checkedAt} prefix="서버 확인" />
      </div>
    )
  }

  // 실제 기록 아님·집계 안 함·원천 미연결·미관측: 0건이 아니라 '보여 줄 수 없는 이유'를 말한다.
  return (
    <p role="status" className="text-base leading-7">
      {snapshot.notice}
    </p>
  )
}
