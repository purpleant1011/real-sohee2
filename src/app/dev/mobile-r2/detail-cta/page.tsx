'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { R2ConversationDetail } from '@/features/mobile-inbox/r2-conversation-detail'
import { ReplyApprovalActions } from '@/features/mobile-approvals/reply-approval-actions'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const THREAD_KEY = 'dm:11111111-1111-4111-8111-111111111111'

/** 검수용 고정 응답. 실제 서버 계약(`isConversationDetail`)을 그대로 통과해야 한다. */
export const DETAIL_CTA_FIXTURE = {
  thread: {
    id: THREAD_KEY,
    workspaceId: WORKSPACE_ID,
    channel: 'instagram_dm',
    customerName: '김민지',
    consent: 'granted',
    status: 'draft_ready',
    unread: true,
    lastMessage: {
      text: '예약 문의드려요',
      receivedAt: '2026-10-23T00:30:00.000Z',
      fromCustomer: true,
    },
    draft: { text: '목요일 2시 가능해요.', sources: ['예약표'] },
    sendBlockers: [],
  },
  messages: [
    { id: 'm1', fromCustomer: true, text: '예약 되나요', at: '2026-10-23T00:30:00.000Z' },
    { id: 'm2', fromCustomer: false, text: '네, 확인해 볼게요', at: '2026-10-23T00:35:00.000Z' },
  ],
  targetLabel: '인스타그램 DM → 김민지',
  fingerprint: 'a'.repeat(64),
  version: 3,
  delivery: 'none',
  complete: true,
}

export const DETAIL_CTA_THREAD_KEY = THREAD_KEY
export const DETAIL_CTA_WORKSPACE_ID = WORKSPACE_ID

/**
 * M13b 대화 상세 5상태와 '최종 검토로 넘어가기' 이동을 실 브라우저에서 관측하는 개발 하네스.
 * 개발 환경 전용 — 운영(production)에서는 404. 실제 조회 대신 고정 응답을 쓴다.
 *
 * `/dev/mobile-r2/detail-cta?mode=ready|partial|empty|offline|error|s401|s403|loading`
 */
export default function DetailCtaDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Harness />
}

function Harness() {
  const [ready, setReady] = useState(false)
  const [review, setReview] = useState(false)

  useEffect(() => {
    // 자식의 조회 effect 보다 먼저 고정 응답이 서도록 첫 렌더는 비운다.
    const mode = new URLSearchParams(window.location.search).get('mode') ?? 'ready'
    const isReview = new URLSearchParams(window.location.search).get('review') === '1'
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 개발 프리뷰 초기화
    setReview(isReview)
    let stored = structuredClone(DETAIL_CTA_FIXTURE)
    const original = window.fetch
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    if (mode === 'offline') {
      // 실제 오프라인 기기는 조회가 실패하면서 navigator.onLine 도 false 다.
      // 예외만 던지면 화면은 '확인 실패'로 떨어져 오프라인 상태를 재현하지 못한다.
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    }
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      if (isReview && url.startsWith(`/api/workspaces/${WORKSPACE_ID}/engagement/`)) return Response.json({ ok: true, deliveryVerified: false })
      if (url.includes('/mobile-inbox/')) {
        if (isReview && url.endsWith('/rewrite')) return Response.json({ draftText: '문의해 주셔서 감사합니다. 가능한 시간을 확인해 안내해 드릴게요.', basedOnFingerprint: stored.fingerprint })
        if (isReview && url.endsWith('/draft') && init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body))
          stored = { ...stored, version: stored.version + 1, fingerprint: 'b'.repeat(64), thread: { ...stored.thread, draft: { ...stored.thread.draft, text: body.draftText } } }
          return Response.json({ saved: true, fingerprint: stored.fingerprint })
        }
        if (mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 60_000))
        if (mode === 'offline') throw new TypeError('Failed to fetch')
        if (mode === 's401') return new Response('{}', { status: 401 })
        if (mode === 's403') return new Response('{}', { status: 403 })
        if (mode === 'error') return new Response('{}', { status: 500 })
        const body =
          mode === 'empty'
            ? { ...DETAIL_CTA_FIXTURE, messages: [] }
            : mode === 'partial'
              ? { ...DETAIL_CTA_FIXTURE, complete: false }
              : isReview ? stored : DETAIL_CTA_FIXTURE
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return original(input as RequestInfo, init)
    }
    // 자식의 조회 effect 가 먼저 돌지 않도록 첫 렌더는 비우고, 스텁을 건 뒤에만 마운트한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 하네스 전용 1회성 게이트
    setReady(true)
    return () => {
      window.fetch = original
      if (onlineDescriptor) Object.defineProperty(navigator, 'onLine', onlineDescriptor)
      else Reflect.deleteProperty(navigator, 'onLine')
    }
  }, [])

  if (!ready) return null
  if (review) return <main className="mx-auto max-w-2xl space-y-4 p-4"><p>개발용 고정 응답 · 실제 고객 전송 없음</p><h1 className="text-xl font-semibold">답안 검토</h1><ReplyApprovalActions workspaceId={WORKSPACE_ID} item={THREAD_KEY} /></main>
  return <R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />
}
