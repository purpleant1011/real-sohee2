'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StateView } from '@/components/mobile-ui'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { authFailureFromStatus, authFailureStateKind, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { ConversationDetailDto } from './detail-model'
import { MobileConversationDetail, conversationScreenConfig } from './detail-view'

import { isConversationDetail } from './conversation-detail-contract'
export { isConversationDetail } from './conversation-detail-contract'
import { ReplyDraftEditor } from './reply-draft-editor'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'

/** 기기가 네트워크에 붙어 있는지. 판정할 수 없는 환경(SSR·구형 브라우저)은 오프라인으로 단정하지 않는다. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: ConversationDetailDto }
  | { kind: 'missing' }
  /** 401 은 로그인 만료, 403 은 권한 없음 — 다음 행동이 달라 한 상태로 뭉개지 않는다(ANI-1714). */
  | { kind: 'denied'; failure: AuthFailure }
  | { kind: 'offline' }
  | { kind: 'error' }

/**
 * M13b 대화 상세 — R2 셸 배선(ANI-1694, 플래그 뒤).
 * 기존 GET /api/workspaces/:id/mobile-inbox/:threadKey 읽기만 사용하며 전송·쓰기 경로가 없다.
 * 고객 대화이므로 응답을 캐시에 남기지 않는다(cache: 'no-store').
 */
export function R2ConversationDetail(props: { workspaceId: string; threadKey: string; embedded?: boolean }) {
  return <ConversationDetailSession key={`${props.workspaceId}:${props.threadKey}`} {...props} />
}
function ConversationDetailSession({ workspaceId, threadKey, embedded = false }: { workspaceId: string; threadKey: string; embedded?: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<DetailState>({ kind: 'loading' })
  const [dirty, setDirty] = useState(false)
  const opening = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [bookingRetryToken, setBookingRetryToken] = useState(0)
  const bookingRevision = `${reloadToken}:${bookingRetryToken}`
  const [bookingRead, setBooking] = useState<{ sourceId: string | undefined; revision: string; loading: boolean; openAllowed: boolean; caseId: string | null; reason: string | null } | null>(null)
  const inboundId = state.kind === 'ready' && threadKey.startsWith('dm:')
    ? [...state.detail.messages].reverse().find(message => message.fromCustomer && /^[a-f0-9-]{36}$/i.test(message.id))?.id
    : undefined
  const booking = bookingRead?.sourceId === inboundId && bookingRead?.revision === bookingRevision
    ? bookingRead
    : { loading: true, openAllowed: false, caseId: null, reason: null }

  useEffect(() => {
    if (!inboundId) return
    const controller = new AbortController()
    void boundedMobileRead(`/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases`, async response => {
      if (!response.ok) throw new Error('예약 관리 권한이나 연결을 확인하지 못했어요. 답안을 복사해서 직접 이어가 주세요.')
      const payload = await response.json()
      if (payload?.workspaceId !== workspaceId || !Array.isArray(payload.cases) || typeof payload.openAllowed !== 'boolean') throw new Error('예약 관리 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
      const cases = payload.cases.filter((item: { caseId?: unknown; sourceThreadId?: unknown; sourceInboundMessageId?: unknown } | null) =>
        item && item.sourceThreadId === threadKey.slice(3) && item.sourceInboundMessageId === inboundId && typeof item.caseId === 'string' && /^[a-f0-9-]{36}$/i.test(item.caseId))
      if (cases.length > 1) throw new Error('연결된 예약 문의를 하나로 확인하지 못했어요. 예약 문의 관리에서 확인해 주세요.')
      return { loading: false, openAllowed: payload.openAllowed, caseId: cases[0]?.caseId ?? null,
        reason: !payload.openAllowed && cases.length === 0 ? '새 예약 문의를 여는 기능이 비활성화되어 있어요. 답안을 복사해서 직접 이어가 주세요.' : null }
    }, controller.signal).then(value => {
      if (!controller.signal.aborted) setBooking({ ...value, sourceId: inboundId, revision: bookingRevision })
    }).catch(reason => {
      if (!controller.signal.aborted) setBooking({ sourceId: inboundId, revision: bookingRevision, loading: false, openAllowed: false, caseId: null, reason: reason instanceof Error ? reason.message : '예약 관리 상태 확인 필요' })
    })
    return () => controller.abort()
  }, [workspaceId, threadKey, inboundId, bookingRevision])

  useEffect(() => {
    let cancelled = false
    const apply = (next: DetailState) => {
      if (!cancelled) setState(next)
    }
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-inbox/${encodeURIComponent(threadKey)}`,
      { cache: 'no-store' },
    )
      .then(async (res) => {
        // 400/404 는 '이 대화를 볼 수 없다'는 서버 판정이다. 조회 실패(5xx)와 구분한다.
        if (res.status === 400 || res.status === 404) return apply({ kind: 'missing' })
        // 인증 만료(401)와 권한 없음(403)은 재시도로 풀리지 않는다. 서로 다른 안내로 남긴다.
        const denied = authFailureFromStatus(res.status)
        if (denied) return apply({ kind: 'denied', failure: denied })
        if (!res.ok) return apply({ kind: 'error' })
        const payload: unknown = await res.json().catch(() => null)
        if (isConversationDetail(payload, workspaceId, threadKey)) return apply({ kind: 'ready', detail: payload })
        return apply({ kind: 'error' })
      })
      // 네트워크가 끊긴 실패는 '확인 실패'와 다르다. 오프라인으로 알린다.
      .catch(() => apply({ kind: isOffline() ? 'offline' : 'error' }))
    return () => {
      cancelled = true
    }
  }, [workspaceId, threadKey, reloadToken])

  const retry = () => {
    setState({ kind: 'loading' })
    setReloadToken((token) => token + 1)
  }
  async function openBooking() {
    if (state.kind !== 'ready' || dirty || opening.current || navigator.onLine === false || booking.loading || (!booking.caseId && !booking.openAllowed)) return
    const source = [...state.detail.messages].reverse().find(m => m.fromCustomer && /^[a-f0-9-]{36}$/i.test(m.id))
    if (!source || !threadKey.startsWith('dm:')) return
    opening.current = true
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases`
      const response = booking.caseId ? null : await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceInboundMessageId: source.id }), cache: 'no-store', signal: controller.signal })
      const body = response ? await response.json() : { case: { caseId: booking.caseId } }
      if ((response && !response.ok) || typeof body.case?.caseId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.case.caseId)) throw new Error('예약 문의를 열지 못했어요. 기능·권한·연결을 확인해 주세요.')
      const read = await fetch(`${url}/${encodeURIComponent(body.case.caseId)}`, { cache: 'no-store', signal: controller.signal })
      const canonical = await read.json()
      if (!read.ok || canonical.case?.caseId !== body.case.caseId || canonical.case?.sourceThreadId !== threadKey.slice(3) || controller.signal.aborted) throw new Error('예약 문의 저장본을 확인하지 못했어요.')
      router.push(`/app/inbox/${encodeURIComponent(body.case.caseId)}`)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '예약 문의 상태 확인 필요') }
    finally { clearTimeout(timer); opening.current = false }
  }
  const { mode, title } = conversationScreenConfig()
  const retryAction = (
    <button
      type="button"
      onClick={retry}
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-muted px-4 text-sm font-medium text-foreground"
    >
      다시 확인하기
    </button>
  )

  const content = (
    <>
        {state.kind === 'ready' ? (
          <div className="space-y-4">
          <ReplyDraftEditor key={`${state.detail.thread.id}:${state.detail.version}`} workspaceId={workspaceId} detail={state.detail} onDirty={setDirty} onSaved={() => { setDirty(false); retry() }} />
          {threadKey.startsWith('dm:') && state.detail.messages.some(m => m.fromCustomer && /^[a-f0-9-]{36}$/i.test(m.id)) ? <button type="button" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border px-4 text-sm" disabled={dirty || booking.loading || (!booking.caseId && !booking.openAllowed)} onClick={() => void openBooking()}>이 문의의 예약 관리 열기</button> : null}
          {inboundId && booking.loading ? <p role="status" className="text-sm text-muted-foreground">예약 관리 연결을 확인하고 있어요.</p> : null}
          {booking.reason ? <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-muted-foreground">{booking.reason}</p>
            <button type="button" onClick={() => setBookingRetryToken(value => value + 1)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm">예약 관리 연결 다시 확인</button>
          </div> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
          <MobileConversationDetail
            detail={state.detail}
            inlineActions={embedded}
            onCopyDraft={async (_key, text) => { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text); setNotice('답안을 복사했어요. 고객에게 전송된 것은 아니에요.') } catch { setNotice('복사하지 못했어요. 브라우저 권한을 확인해 주세요.') } }}
            // 검토 화면(M19 승인 확인)으로만 이동한다. 여기서 발송하지 않으며,
            // M19 는 같은 키(`dm:`/`comment:`)로 서버 진실을 다시 읽어 자체 게이트를 건다.
            onProceedToReview={dirty ? undefined : ({ threadId }) => router.push(`/app/approvals?item=${encodeURIComponent(threadId)}`)}
          />
          </div>
        ) : state.kind === 'loading' ? (
          <StateView kind="loading" skeleton="detail" skeletonRows={3} />
        ) : state.kind === 'missing' ? (
          <StateView
            kind="confirmed_empty"
            title="대화를 찾지 못했어요"
            description="이미 정리됐거나 지금은 볼 수 없는 대화예요."
          />
        ) : state.kind === 'denied' ? (
          <StateView kind={authFailureStateKind(state.failure)} />
        ) : state.kind === 'offline' ? (
          <StateView kind="offline" action={retryAction} />
        ) : (
          <StateView kind="error" action={retryAction} />
        )}
    </>
  )
  return embedded ? content : <MobileAppShell><ShellScreen mode={mode} title={title} backHref="/app/engagement">{content}</ShellScreen></MobileAppShell>
}
