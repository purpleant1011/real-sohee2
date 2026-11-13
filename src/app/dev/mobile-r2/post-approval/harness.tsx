'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MobileApprovalScreen } from '@/features/mobile-decision/mobile-approval-view'
import { R2ApprovalDetail } from '@/features/mobile-approvals/r2-approval-view'
import { MobileAppShell } from '@/features/mobile-shell'
import type { MobileApprovalView } from '@/features/mobile-decision/contracts'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const missionId = '22222222-2222-4222-8222-222222222222'
const view: MobileApprovalView = {
  workspaceId, id: `post:${missionId}`, kind: 'post_publish', title: '이번 주 매장 소식',
  targetLabel: '연결된 게시 채널', sourceText: '이번 주 매장 소식', fullContent: '저장한 게시 문안',
  imageUrls: [], datasetMode: 'ACTUAL', writeState: 'unsupported', reason: '최종 승인 전에 내용을 확인해요.',
}
const draft = {
  missionId, workspaceId, datasetMode: 'ACTUAL', status: 'AWAITING_EXACT_APPROVAL',
  topic: '매장 소식', goal: '소식 알리기', createdAt: '2026-10-28T00:00:00Z',
  approvalFingerprint: 'a'.repeat(64), selectedImageIds: [],
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
  boundVersions: { knowledge: 1, textHarness: 1, imageHarness: 1, policy: 1 },
  copies: { instagram: { caption: '저장한 게시 문안', cta: '' }, threads: { content: '저장한 스레드 문안', cta: '' } },
  channels: [{ provider: 'instagram', handle: '@example', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
}

/** 개발 전용: 모든 fetch를 격리한다. ACTUAL은 분기 검증용이며 실제 계정/쓰기 근거가 아니다. */
export function PostApprovalHarness() {
  const [ready, setReady] = useState(false)
  const [r2, setR2] = useState(false)
  useEffect(() => {
    const original = window.fetch
    window.fetch = async (input, options) => {
      const url = String(input)
      if (options?.method && options.method !== 'GET') return Response.json({ error: '개발 화면에서는 저장·승인·게시하지 않아요.' }, { status: 409 })
      if (url === `/api/missions/first-post/${missionId}`) return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft })
      if (url.includes(`/mobile-approvals/${encodeURIComponent(view.id)}`)) return Response.json(view)
      return Response.json({ error: '개발 화면에서 허용하지 않은 요청이에요.' }, { status: 404 })
    }
    const frame = requestAnimationFrame(() => setReady(true))
    return () => { cancelAnimationFrame(frame); window.fetch = original }
  }, [])
  return <main className="mx-auto min-h-dvh max-w-2xl space-y-4 bg-background p-4 text-foreground">
    <p role="note" className="text-sm text-muted-foreground">개발용 고정 응답 · 실제 서버 호출과 외부 실행 없음</p>
    <Button variant="outline" onClick={() => setR2(value => !value)}>{r2 ? 'R1 화면 확인' : 'R2 화면 확인'}</Button>
    {ready ? r2 ? <MobileAppShell><R2ApprovalDetail workspaceId={workspaceId} item={view.id} /></MobileAppShell> : <MobileApprovalScreen view={view} onBack={() => {}} onRefresh={() => {}} /> : <p>개발 화면 준비 중</p>}
  </main>
}
