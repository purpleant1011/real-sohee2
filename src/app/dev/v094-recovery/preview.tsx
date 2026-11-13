'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCard } from '@/features/chat/message-card'
import { ConversationClient } from '@/features/chat/conversation-client'
import { MagicPhotoDropzone } from '@/components/home-today/magic-photo-dropzone'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { MissionConversationContinuation } from '@/components/missions/mission-conversation-continuation'
import { MobileHubView } from '@/features/mobile-hub/hub-view'
import { toWorkList } from '@/features/mobile-hub/work-items'
import { MobileMoreView } from '@/features/mobile-settings/more-view'
import { buildMoreSnapshot } from '@/features/mobile-settings/server/more-snapshot'
import { NotificationList } from '@/features/mobile-notifications/notification-list'
import { CustomerInquiryReview, CustomerQueryScope } from '@/features/customers/customer-inquiry-review'
import { useTheme } from '@/components/theme-provider'
import { DesktopConversationReview } from '@/features/engagement/desktop-conversation-review'
import { MobileConversationDetail } from '@/features/mobile-inbox/detail-view'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const source = toWorkList({ success: true, complete: true, hasMore: false, contents: [
  { contentId: 'draft', workspaceId, title: '저장된 옛 초안', channel: 'threads', status: 'draft' },
  { contentId: 'pending', workspaceId, title: '외부 확인 근거가 없는 완료 기록', channel: 'instagram', status: 'completed' },
] }, workspaceId)

export function HomePhotoPreparationPreview() {
  const [prepared, setPrepared] = useState(false)
  const [localUpload, setLocalUpload] = useState<Blob | null>(null)
  const localImage = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (!localUpload || !localImage.current) return
    const url = URL.createObjectURL(localUpload)
    localImage.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [localUpload])
  const [request] = useState<typeof fetch>(() => {
    let item: { missionId: string; imageIds: string[] } | null = null
    const photoId = '60000000-0000-4000-8000-000000000001'
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/onboarding/media') {
        if (!init?.method) return Response.json({ items: [{ id: photoId, rights_status: 'confirmed', publish_eligibility: true }] })
        const body = JSON.parse(String(init.body))
        if (body.action === 'select') return Response.json({ selected: true })
        if (body.action === 'begin') return Response.json({ assetId: photoId, signedUrl: '/test-local-photo-only' })
        if (body.action === 'complete') return Response.json({ assetId: photoId })
        return Response.json({ error: 'TEST에서는 사용 중단을 실행하지 않아요.' }, { status: 403 })
      }
      if (url === '/test-local-photo-only' && init?.method === 'PUT' && init.body instanceof Blob) {
        setLocalUpload(init.body)
        return new Response(null, { status: 200 })
      }
      if (url.endsWith('/quick-post?limit=1')) return Response.json({ credits: { photoDraftCost: 100 } })
      if (init?.method === 'POST' && url.endsWith('/quick-post')) {
        const body = JSON.parse(String(init.body))
        item = { missionId: body.requestId, imageIds: body.sourceAssetIds }
        return Response.json({ item })
      }
      if (item && url.endsWith(`/quick-post/${item.missionId}`)) return Response.json({ item })
      return Response.json({ error: 'TEST 요청 범위가 아니에요.' }, { status: 403 })
    }
  })
  return <WorkspaceProvider value={{ workspaceId, workspaceName: 'TEST 가게', workspaceKind: null, membershipRole: 'owner', actorId: '20000000-0000-4000-8000-000000000001', resolutionSource: 'membership' }}>
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground">TEST · 저장 사진 목록·견적·원고 응답은 합성 자료예요. 실제 사진 업로드·AI 생성·크레딧 사용·게시는 실행하지 않아요. 원본 미리보기 인증은 이 화면의 검증 범위가 아니에요.</p>
      <MagicPhotoDropzone workspaceId={workspaceId} fetcher={request} onPrepared={() => setPrepared(true)} />
      {localUpload && <figure className="flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={localImage} alt="TEST · 로컬 변환 파일 미리보기" className="max-w-full" />
        <figcaption>TEST · 네트워크 전송 없이 검사한 파일: {localUpload?.type}, {localUpload?.size} bytes. 서버 저장 검증은 실행하지 않았어요.</figcaption>
      </figure>}
      {prepared ? <p role="status" className="rounded-xl border border-border p-4 text-sm">TEST · 선택 사진과 원고 저장본 일치 확인 경로를 통과했어요. 실제 운영 원고가 생성된 것은 아니에요.</p> : null}
    </div>
  </WorkspaceProvider>
}

export function OriginalPhotoRecoveryPreview() {
  const [code, setCode] = useState('CHAT_SOURCE_PHOTO_REQUIRED')
  const request: typeof fetch = async (_input, init) => init?.method === 'POST'
    ? Response.json({ error: { code } }, { status: 422 })
    : Response.json({ error: 'TEST에서는 실제 작업을 실행하지 않아요.' }, { status: 403 })
  return <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4">
    <label className="flex flex-col gap-2 text-sm">TEST · 사진 입력 거절 사례
      <select aria-label="사진 오류 사례" className="min-h-11 rounded-xl border border-border bg-background px-3 text-base" value={code} onChange={event => setCode(event.target.value)}>
        <option value="CHAT_SOURCE_PHOTO_REQUIRED">원본 사진 누락</option>
        <option value="CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED">지원 사진 수 초과</option>
        <option value="CHAT_PHOTO_PLAN_CHANGED">검토한 사진 수 변경</option>
      </select>
    </label>
    <p className="text-sm text-muted-foreground">원본 사진으로 인스타그램 게시물을 만들어 달라고 입력해 보세요. 이 화면에서는 실제 업로드·이미지 생성·크레딧 사용을 하지 않아요.</p>
    <ConversationClient key={code} backgroundJobs initialMessages={[]} workspaceId={workspaceId} threadId="30000000-0000-4000-8000-000000000001" messageRequest={request} />
  </div>
}

export function InterviewQuestionPreview() {
  const question = '이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?'
  return <ul className="mx-auto max-w-2xl p-4"><MessageCard message={{
    id: '20000000-0000-4000-8000-000000000001', workspaceId, threadId: '30000000-0000-4000-8000-000000000001', role: 'sohee', status: 'completed', workItemId: null,
    content: `요청하신 방향을 확인할게요.\n\n1 / 4 ${question}`, createdAt: '2026-11-02T10:00:00Z', completedAt: '2026-11-02T10:00:01Z',
    clarification: { kind: 'content_interview', status: 'collecting', step: 1, totalSteps: 4, question, options: [{ value: 'consultation', label: '상담 문의를 늘리고 싶어요' }], optionGroups: [], previousAnswers: [] },
  }} onSubmit={() => false} /></ul>
}

export function MissionContinuationPreview() {
  const [notice, setNotice] = useState(false)
  return <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
    <MissionConversationContinuation onContinue={() => setNotice(true)} />
    {notice ? <p role="status">TEST · 새 대화나 외부 실행 없이 현재 업무의 조정으로 이어져요.</p> : null}
  </div>
}

export function PreviewThemeControl() {
  const { resolvedTheme, setTheme } = useTheme()
  return <button type="button" aria-label="TEST 테마 전환" className="min-h-11 rounded-lg border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>TEST 테마: {resolvedTheme === 'dark' ? '어둡게' : '밝게'}</button>
}

export function SettingsSourcePreview() {
  const [mode, setMode] = useState<'OFF' | 'RUNNING' | 'BLOCKED'>('OFF')
  const [failed, setFailed] = useState(false)
  const [checkedAt, setCheckedAt] = useState('2026-11-03T00:00:00Z')
  const ok = <T,>(value: T) => ({ ok: true, value })
  const snapshot = buildMoreSnapshot({
    workspaceId, workspaceName: 'TEST 가게', membershipRole: 'owner', now: checkedAt,
    profile: ok({ businessName: 'TEST 가게' }), channels: ok({ publishable: 1, needsCheck: 0, unchecked: 0 }), billing: ok({ needsAttention: false }),
    automation: failed ? { ok: false, value: null } : ok({ mode, checkedAt }),
    notifications: failed ? { ok: false, value: null } : ok({ recentCount: 14, unreadCount: 5, checkedAt }),
  })
  return <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
    <p className="text-sm text-muted-foreground">TEST · 상태·시각·건수는 합성 자료이며 실제 설정 변경·알림 전송은 없어요.</p>
    <label className="flex flex-col gap-2 text-sm">TEST 자동 업무 상태<select className="min-h-11 rounded-lg border border-border bg-background px-3 text-foreground" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="OFF">꺼짐</option><option value="RUNNING">켜짐</option><option value="BLOCKED">안전 제어 중지</option></select></label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={failed} onChange={event => setFailed(event.target.checked)} />TEST 부분 조회 실패</label>
    <MobileMoreView snapshot={snapshot} onRetry={() => { setFailed(false); setCheckedAt(new Date().toISOString()) }} />
  </div>
}

export function NotificationsReturnPreview() {
  return <div className="p-4"><p className="mb-4 text-sm text-muted-foreground">TEST · 합성 알림이에요. 링크의 from 값과 게시 필터 복원을 검사하며 실제 원고·게시·읽음 처리는 실행하지 않아요.</p><NotificationList workspaceId={workspaceId} data={{
    userId: '20000000-0000-4000-8000-000000000001', preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true },
    notifications: [{ id: '30000000-0000-4000-8000-000000000001', kind: 'publish', body: '게시 처리 상태를 확인해 주세요.', href: '/app/work/40000000-0000-4000-8000-000000000001', readAt: '2026-11-03T00:00:00Z', createdAt: '2026-11-03T00:00:00Z' }, { id: '50000000-0000-4000-8000-000000000001', kind: 'system', body: 'TEST 다른 종류의 알림', href: null, readAt: '2026-11-03T00:00:00Z', createdAt: '2026-11-03T00:00:00Z' }],
  }} /></div>
}

export function DesktopReviewPreview() {
  const [notice, setNotice] = useState('')
  return <><p className="p-4 text-sm text-muted-foreground">TEST · PC 표현만 검증하는 합성 대화예요. 실제 고객·원장 조회·예약·발송은 실행하지 않아요.</p><DesktopConversationReview><MobileConversationDetail inlineActions detail={{
    thread: { id: 'dm:60000000-0000-4000-8000-000000000001', workspaceId, channel: 'instagram_dm', customerName: 'TEST 합성 대화', consent: 'granted', status: 'draft_ready', unread: false, lastMessage: { text: '예약 조건을 확인하고 싶어요.', receivedAt: '2026-11-03T00:00:00Z', fromCustomer: true }, draft: { text: '서비스와 가격, 가능한 시간을 확인한 뒤 안내드릴게요.', sources: [] }, sendBlockers: [] },
    messages: [{ id: '70000000-0000-4000-8000-000000000001', text: '예약 조건을 확인하고 싶어요.', fromCustomer: true, at: '2026-11-03T00:00:00Z' }],
    fingerprint: 'a'.repeat(64), version: 1, targetLabel: 'TEST 합성 대상', delivery: 'none', complete: true,
  }} onProceedToReview={() => setNotice('TEST · 최종 검토 이동 콜백만 확인했어요. 발송·예약 확정은 실행하지 않았어요.')} />{notice ? <p role="status" className="mt-3 text-sm">{notice}</p> : null}</DesktopConversationReview></>
}

export function CustomerReviewPreview() {
  return <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
    <p className="text-sm text-muted-foreground">TEST · 합성 문의의 읽기 전용 인계 UI예요. 고객 조회·예약 확정·발송은 실행하지 않아요.</p>
    <h1 className="text-xl font-semibold">문의와 예약 검토</h1>
    <CustomerQueryScope />
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4"><h2 className="font-medium">TEST · 오래된 문의</h2><p className="text-sm text-muted-foreground">상담 만료 · 예약 수락과 가능 시간 확인 필요</p><CustomerInquiryReview threadId="60000000-0000-4000-8000-000000000001" /></section>
  </div>
}

export function RecoveryListPreview() {
  return <div className="p-4"><MobileHubView workspaceId={workspaceId} source={{ ...source, loadState: 'ready', refresh: () => {} }} /></div>
}
