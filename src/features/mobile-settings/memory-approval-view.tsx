'use client'

import { useState } from 'react'
import { StateView } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { memoryPreview, memoryReadiness, type MemoryCandidate } from './memory-approval'
import {
  decisionMessage,
  type MemoryDecision,
  type MemoryDecisionUiState,
} from './r2-memory-decisions'

/**
 * M22(ANI-1709) 우리 가게 기억 승인 화면. 소희가 알아낸 값은 승인 전까지 고객에게 쓰지 않는다.
 * 확정/추측/변경 제안을 구분하고, 출처·업데이트 시각·차단 사유를 함께 보여준다.
 */
export interface MemoryApprovalViewSnapshot {
  loadState: LoadState
  candidates: MemoryCandidate[]
  /** 서버가 전체 목록을 확인했는지. false 면 빈 목록을 '없음'으로 단정하지 않는다. */
  complete: boolean
  checkedAt: string | null
}

export function MobileMemoryApprovalView({
  snapshot,
  onDecide,
  decisionStates,
}: {
  snapshot: MemoryApprovalViewSnapshot
  /** 사장님이 버튼을 눌렀을 때만 호출된다. 없으면 버튼은 잠긴다. */
  onDecide?: (proposalId: string, decision: MemoryDecision) => void
  decisionStates?: Record<string, MemoryDecisionUiState>
}) {
  const kind = listKind(snapshot.loadState, snapshot.candidates, snapshot.complete)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">가게 기억</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          승인하기 전까지 소희가 새로 알아낸 내용은 고객에게 보이지 않아요.
        </p>
      </header>

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={3}
        title={kind === 'confirmed_empty' ? '확인할 가게 정보가 없어요' : undefined}
        description={kind === 'confirmed_empty' ? '확인해 보니 새로 알려드릴 정보가 없습니다.' : undefined}
      >
        <ul aria-label="가게 기억 후보" className="space-y-3">
          {snapshot.candidates.map(candidate => (
            <MemoryCard
              key={candidate.proposalId}
              candidate={candidate}
              state={decisionStates?.[candidate.proposalId] ?? { kind: 'idle' }}
              onDecide={onDecide}
            />
          ))}
        </ul>
      </StateView>
    </div>
  )
}

export function memoryApprovalScreenConfig(): ShellScreenConfig {
  return { mode: 'REVIEW', title: '가게 기억' }
}

function MemoryCard({
  candidate,
  state,
  onDecide,
}: {
  candidate: MemoryCandidate
  state: MemoryDecisionUiState
  onDecide?: (proposalId: string, decision: MemoryDecision) => void
}) {
  // 자동 승인 금지: 값이 바뀐 제안은 사장님이 직접 비교를 확인해야 승인할 수 있다.
  const [reconfirmed, setReconfirmed] = useState(false)
  const preview = memoryPreview(candidate)
  const readiness = memoryReadiness(candidate, { reconfirmed })
  const busy = state.kind === 'submitting'
  const finished = state.kind === 'decided' || state.kind === 'already_handled'
  // 배선이 없으면 아무 것도 쓰지 않는다(잠금). 저장 중·이미 처리된 항목도 다시 누를 수 없다.
  const locked = busy || finished || !onDecide
  const approveAllowed = readiness.allowed && !locked
  const notice = decisionMessage(state)

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold">{preview.fieldLabel}</p>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {preview.kindLabel}
        </span>
      </div>

      <dl className="space-y-1 text-sm leading-5">
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">지금</dt>
          <dd>{preview.currentValue ?? '아직 기억하지 못했어요'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">새 값</dt>
          <dd className="font-medium">{preview.proposedValue || '입력된 값이 없어요'}</dd>
        </div>
      </dl>

      {preview.sourceLabel ? (
        <p className="text-xs leading-4 text-muted-foreground">
          출처: {preview.sourceLabel}
          {preview.observedAt ? ` · ${dateOnly(preview.observedAt)} 확인` : ''}
        </p>
      ) : (
        <p className="text-xs leading-4 text-muted-foreground">출처를 확인하지 못했어요</p>
      )}

      {preview.impactNote ? (
        <p className="text-sm leading-5 text-muted-foreground">{preview.impactNote}</p>
      ) : null}

      {readiness.requiresReconfirm && !reconfirmed ? (
        <>
          <p className="text-sm leading-5">기존 값과 달라요. 승인 전에 한 번 더 확인해 주세요.</p>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm leading-5">
            <input
              type="checkbox"
              checked={reconfirmed}
              onChange={event => setReconfirmed(event.target.checked)}
              className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
            />
            <span>기존 값과 비교해 확인했어요</span>
          </label>
        </>
      ) : null}

      <p className="text-xs leading-4 text-muted-foreground">
        {preview.customerVisible
          ? '승인 전에는 고객에게 보이지 않아요.'
          : '이 내용은 고객 안내에 쓰이지 않아요.'}
      </p>

      {readiness.blockers.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-muted px-3 py-2">
          {readiness.blockers.map(blocker => (
            <li key={blocker.code} className="text-sm leading-5">
              {blocker.message}
              {blocker.next ? (
                <span className="text-muted-foreground"> · {blocker.next}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === 'alert' ? 'alert' : 'status'}
          className={notice.tone === 'alert' ? 'text-sm leading-5 text-destructive' : 'text-sm leading-5'}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          disabled={!approveAllowed}
          aria-disabled={!approveAllowed}
          onClick={() => onDecide?.(candidate.proposalId, 'confirm')}
          className={
            approveAllowed
              ? 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground'
              : 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-muted px-3.5 text-sm font-medium text-muted-foreground'
          }
        >
          이 내용으로 승인
        </button>
        <button
          type="button"
          disabled={locked}
          aria-disabled={locked}
          onClick={() => onDecide?.(candidate.proposalId, 'reject')}
          className={
            locked
              ? 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-muted px-3.5 text-sm font-medium text-muted-foreground'
              : 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground'
          }
        >
          이 내용은 아니에요
        </button>
      </div>
    </li>
  )
}

function listKind(state: LoadState, items: unknown[] | null, complete: boolean): 'loading' | 'ready' | 'error' | 'stale' | 'confirmed_empty' | 'partial' {
  if (state === 'loading') return 'loading'
  if (state === 'error' || state === 'unknown') return 'error'
  if (state === 'stale') return 'stale'
  if (!items || items.length === 0) return complete ? 'confirmed_empty' : 'partial'
  return complete ? 'ready' : 'partial'
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}
