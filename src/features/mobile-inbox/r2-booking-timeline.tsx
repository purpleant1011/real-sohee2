'use client'

import { useEffect, useRef, useState } from 'react'
import { StateChip, StateView } from '@/components/mobile-ui'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import type { BookingTimeline } from './booking-timeline-model'
import { bookingTimelineStateChip, type BookingTimelineStateChip } from './booking-timeline-state'
import { BookingTimelineBody, bookingTimelineScreenConfig } from './booking-timeline-view'
import { isRecoveryCaseResponse, recoveryTimeline } from './recovery-timeline-model'
import type { RecoveryCommand, RecoveryView } from '@/features/booking-recovery/contracts'
import { RecoveryWorkflow } from './recovery-workflow'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'

/** 서버가 전송 결과를 확정하지 못한 단계. 화면이 '보냈다'로 읽히면 안 된다. */
const UNRESOLVED_STAGES: readonly string[] = ['RESULT_UNKNOWN', 'NEEDS_RECONCILIATION']

interface Identity {
  customerName: string
  inquiryText: string | null
  messages: Array<{ id: string; text: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 기기가 네트워크에 붙어 있는지. 판정할 수 없는 환경(SSR·구형 브라우저)은 오프라인으로 단정하지 않는다. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * 고객 표시 이름·원문은 기존 대화 상세 읽기 API 에서만 가져온다(회수 계약에는 표시용 필드가 없다).
 * 실패해도 타임라인은 그리되, 이름과 원문을 지어내지 않는다.
 */
async function readIdentity(workspaceId: string, threadId: string): Promise<Identity | null> {
  const threadKey = `dm:${threadId}`
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-inbox/${encodeURIComponent(threadKey)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return null
  const payload: unknown = await res.json().catch(() => null)
  if (!isRecord(payload) || !isRecord(payload.thread)) return null
  const thread = payload.thread
  if (thread.id !== threadKey || thread.workspaceId !== workspaceId) return null
  if (typeof thread.customerName !== 'string' || !thread.customerName) return null
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const lastCustomer = [...messages]
    .reverse()
    .find((m) => isRecord(m) && m.fromCustomer === true && typeof m.text === 'string')
  return {
    customerName: thread.customerName,
    inquiryText: isRecord(lastCustomer) && typeof lastCustomer.text === 'string' ? lastCustomer.text : null,
    messages: messages.filter((m): m is Record<string, unknown> => isRecord(m) && m.fromCustomer === true && typeof m.text === 'string' && typeof m.id === 'string' && /^[a-f0-9-]{36}$/i.test(m.id)).map(m => ({ id: String(m.id), text: String(m.text) })),
  }
}

type TimelineState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      view: RecoveryView
      messages: Array<{ id: string; text: string }>
      timeline: BookingTimeline
      customerName: string | null
      inquiryText: string | null
      /** 대화에서 이름·원문을 실제로 확인했는지. */
      identityVerified: boolean
      /** 서버가 이 케이스를 확인한 시각. */
      observedAt: string | null
      /** 전송 결과가 아직 확정되지 않은 단계인지. */
      outcomeUnresolved: boolean
    }
  | { kind: 'missing' }
  | { kind: 'unauthorized' }
  | { kind: 'offline' }
  | { kind: 'error' }

/**
 * M14 예약 문의 타임라인 — R2 셸 배선(ANI-1690, 플래그 뒤).
 * 기존 예약 회수 읽기 API(`GET …/booking-recovery/cases/:caseId`)만 사용하며 전송·쓰기 경로가 없다.
 * 고객 대화가 섞이므로 응답을 캐시에 남기지 않는다(cache: 'no-store').
 */
export function R2BookingTimeline(props: { workspaceId: string; caseId: string; embedded?: boolean }) {
  return <BookingTimelineSession key={`${props.workspaceId}:${props.caseId}`} {...props} />
}
function BookingTimelineSession({ workspaceId, caseId, embedded = false }: { workspaceId: string; caseId: string; embedded?: boolean }) {
  const [state, setState] = useState<TimelineState>({ kind: 'loading' })
  const commandPending = useRef(false)
  const runExternalWrite = useExternalWriteGuard()
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const apply = (next: TimelineState) => {
      if (!cancelled) setState(next)
    }
    const load = async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases/${encodeURIComponent(caseId)}`,
        { cache: 'no-store' },
      )
      // 404 는 '이 케이스를 볼 수 없다'는 서버 판정이고, 403 은 기능 게이트·권한이다.
      if (res.status === 404) return apply({ kind: 'missing' })
      if (res.status === 401 || res.status === 403) return apply({ kind: 'unauthorized' })
      if (!res.ok) return apply({ kind: 'error' })
      const payload: unknown = await res.json().catch(() => null)
      if (!isRecoveryCaseResponse(payload, caseId)) return apply({ kind: 'error' })
      const view = payload.case
      // 이름·원문 조회가 실패해도 단계는 보여준다. 대신 없는 값을 채우지 않는다.
      const identity = await readIdentity(workspaceId, view.sourceThreadId).catch(() => null)
      apply({
        kind: 'ready',
        view,
        messages: identity?.messages ?? [],
        timeline: recoveryTimeline(view),
        customerName: identity?.customerName ?? null,
        inquiryText: identity?.inquiryText ?? null,
        identityVerified: identity?.customerName != null,
        observedAt: view.observedAt,
        outcomeUnresolved: UNRESOLVED_STAGES.includes(view.stage),
      })
    }
    // 네트워크가 끊긴 실패는 '확인 실패'와 다르다. 오프라인으로 알린다.
    load().catch(() => apply({ kind: isOffline() ? 'offline' : 'error' }))
    return () => {
      cancelled = true
    }
  }, [workspaceId, caseId, reloadToken])

  const retry = () => {
    setState({ kind: 'loading' })
    setReloadToken((token) => token + 1)
  }
  async function command(cmd: RecoveryCommand) {
    if (state.kind !== 'ready' || commandPending.current || isOffline()) throw new Error('최신 상태와 연결을 확인한 뒤 시도해 주세요.')
    commandPending.current = true
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000)
    const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases/${encodeURIComponent(caseId)}`
    try {
      const perform = async () => {
      const response = await fetch(`${url}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(response.status === 409 ? '다른 곳에서 상태가 바뀌었어요. 최신 상태를 다시 확인해 주세요.' : '요청 결과를 확인하지 못했어요. 다시 보내지 말고 상태를 조회해 주세요.')
      const read = await fetch(url, { cache: 'no-store', signal: controller.signal })
      const payload: unknown = await read.json()
      if (!read.ok || !isRecoveryCaseResponse(payload, caseId) || controller.signal.aborted) throw new Error('서버 처리 결과를 확인하지 못했어요.')
      return payload.case
      }
      const outcome = cmd.kind === 'approve_send' || cmd.kind === 'approve_booking'
        ? await runExternalWrite(cmd.kind === 'approve_send' ? 'send' : 'reservation', `recovery:${caseId}`, perform)
        : { ran: true as const, value: await perform() }
      if (!outcome.ran) throw new Error(outcome.decision.message)
      const canonical = outcome.value
      setState({ ...state, view: canonical, timeline: recoveryTimeline(canonical), observedAt: canonical.observedAt, outcomeUnresolved: UNRESOLVED_STAGES.includes(canonical.stage) })
    } catch (error) { setState({ kind: 'error' }); throw error }
    finally { clearTimeout(timer); commandPending.current = false }
  }
  const { mode, title } = bookingTimelineScreenConfig()
  const retryAction = (
    <button
      type="button"
      onClick={retry}
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-muted px-4 text-sm font-medium text-foreground"
    >
      다시 확인하기
    </button>
  )

  // 조회가 어디까지 확인됐는지는 화면이 직접 말한다. '확인된 전체'일 때만 칩이 없다.
  const chip: BookingTimelineStateChip | null =
    state.kind === 'ready'
      ? bookingTimelineStateChip({
          loadKind: 'ready',
          observedAt: state.observedAt,
          identityVerified: state.identityVerified,
          outcomeUnresolved: state.outcomeUnresolved,
        })
      : bookingTimelineStateChip({ loadKind: state.kind })

  const content = (
    <>
        {state.kind === 'ready' ? (
          <div className="min-w-0 space-y-4">
          <RecoveryWorkflow workspaceId={workspaceId} view={state.view} messages={state.messages} onCommand={command} />
          <BookingTimelineBody
            inquiryId={caseId}
            timeline={state.timeline}
            customerName={state.customerName}
            inquiryText={state.inquiryText}
            stateChip={chip}
            checkedAt={state.observedAt}
          />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-3 pb-6 text-foreground">
            {chip ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StateChip kind={chip.kind} label={chip.label} />
              </div>
            ) : null}
            {state.kind === 'loading' ? (
              <StateView kind="loading" skeleton="detail" skeletonRows={3} />
            ) : state.kind === 'missing' ? (
              <StateView
                kind="confirmed_empty"
                title="예약 문의를 찾지 못했어요"
                description="이미 정리됐거나 지금은 볼 수 없는 문의예요."
              />
            ) : state.kind === 'unauthorized' ? (
              <StateView kind="unauthorized" />
            ) : state.kind === 'offline' ? (
              <StateView kind="offline" action={retryAction} />
            ) : (
              <StateView kind="error" action={retryAction} />
            )}
          </div>
        )}
    </>
  )
  return embedded ? content : <MobileAppShell><ShellScreen mode={mode} title={title} backHref="/app/inbox">{content}</ShellScreen></MobileAppShell>
}
