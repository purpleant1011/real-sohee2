'use client'

import { useMemo } from 'react'
import { R2WorkApprove } from '@/features/mobile-approvals/r2-work-approve'
import { MobileAppShell } from '@/features/mobile-shell'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const CONTENT_ID = '00000000-0000-4000-8000-000000000002'
const VERSION_ID = '00000000-0000-4000-8000-000000000003'
const FINGERPRINT = 'e'.repeat(64)

function makeSyntheticSnapshot(state: string): ApprovalPreviewSnapshot {
  const base: ApprovalPreviewSnapshot = {
    workspaceId: WORKSPACE_ID,
    contentId: CONTENT_ID,
    versionId: VERSION_ID,
    versionNumber: 2,
    fingerprint: FINGERPRINT,
    approval: { id: null, status: 'unreviewed', fingerprint: null },
    channel: 'instagram',
    account: {
      connectionId: '00000000-0000-4000-8000-000000000004',
      label: '@sohee.ai',
      status: 'connected',
    },
    caption: '가을 신메뉴 오픈! 따뜻한 라떼와 함께 여유를 즐겨보세요.\n\n#카페 #가을신메뉴',
    hashtags: ['#카페', '#가을신메뉴'],
    disclosure: '소희 AI 마케팅 어시스턴트로 작성되었습니다.',
    text: '가을 신메뉴 오픈! 따뜻한 라떼와 함께 여유를 즐겨보세요.\n\n#카페 #가을신메뉴',
    media: [
      {
        id: '00000000-0000-4000-8000-000000000005',
        position: 1,
        mimeType: 'image/jpeg',
        altText: '가을 신메뉴 라떼 연출 사진',
        src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="%23f59e0b"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="24">Media 1</text></svg>',
        width: 400,
        height: 400,
        sizeBytes: 12000,
      },
      {
        id: '00000000-0000-4000-8000-000000000006',
        position: 2,
        mimeType: 'image/jpeg',
        altText: '매장 가을 인테리어 사진',
        src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="%233b82f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="24">Media 2</text></svg>',
        width: 400,
        height: 400,
        sizeBytes: 15000,
      },
    ],
    issues: [],
  }

  if (state === 'approved') {
    return {
      ...base,
      approval: { id: '00000000-0000-4000-8000-000000000007', status: 'approved', fingerprint: FINGERPRINT },
    }
  }

  if (state === 'blocked') {
    return {
      ...base,
      caption: '가을 이벤트 기간: [이벤트 기간]\n참여 시 [할인율]% 할인 혜택을 드려요.',
      text: '가을 이벤트 기간: [이벤트 기간]\n참여 시 [할인율]% 할인 혜택을 드려요.',
      approval: { id: '00000000-0000-4000-8000-000000000007', status: 'approved', fingerprint: FINGERPRINT },
    }
  }

  if (state === 'naver') {
    return {
      ...base,
      channel: 'naver_blog',
      caption: '네이버 블로그 가을 신메뉴 안내 포스팅 원고입니다.',
      text: '네이버 블로그 가을 신메뉴 안내 포스팅 원고입니다.',
    }
  }

  if (state === 'naver_approved') {
    return {
      ...base,
      channel: 'naver_blog',
      approval: { id: '00000000-0000-4000-8000-000000000008', status: 'approved', fingerprint: FINGERPRINT },
      caption: '네이버 블로그 가을 신메뉴 안내 포스팅 원고입니다.',
      text: '네이버 블로그 가을 신메뉴 안내 포스팅 원고입니다.',
    }
  }

  return base
}

export function WorkApproveDevHarness({ state = 'unreviewed' }: { state?: string }) {
  const snapshot = useMemo(() => makeSyntheticSnapshot(state), [state])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="border-b border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">[Dev Fixture]</span> 합성자료·실제 게시 버튼 누르지 마세요 (가짜 계정 연결, 실제 쓰기 없음) · 상태: <span className="font-mono font-semibold text-primary">{state}</span> (쿼리: ?state=unreviewed | approved | blocked | naver | naver_approved)
      </div>
      <MobileAppShell>
        <R2WorkApprove
          workspaceId={WORKSPACE_ID}
          contentId={CONTENT_ID}
          role="owner"
          snapshot={snapshot}
        />
      </MobileAppShell>
    </div>
  )
}
