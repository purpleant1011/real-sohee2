'use client'

import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkPreviewEntry } from '@/app/app/work/[contentId]/work-preview-entry'

/**
 * M06 홍보 세트 실라우트 진입점 육안 검수용(ANI-1678).
 *
 * 서버 라우트(`/app/work/:id`)와 같은 진입점 컴포넌트를 그대로 마운트하되, 로그인과
 * 서버 조회 없이 고정 스냅샷을 쓴다. 사진은 저장소의 공개 예시 사진이다.
 * 실제 서버 스냅샷이 아니므로 운영 증거가 아니라 화면 배치·상태 확인용이다.
 */
/** 저장소의 공개 예시 사진. 세로형 틀에 가로·정사각 사진이 어떻게 들어가는지 비교한다. */
const SAMPLE_PHOTO: Record<'landscape' | 'square', string> = {
  landscape: '/sohee_insta_post.jpg',
  square: '/sohee_real_eyebrow.jpg',
}

const SNAPSHOT: ApprovalPreviewSnapshot = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  contentId: 'dev-content',
  versionId: 'dev-version-1',
  versionNumber: 1,
  fingerprint: '0'.repeat(64),
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: 'dev-connection', label: '인스타그램', status: 'connected' },
  caption: '',
  hashtags: [],
  disclosure: '',
  text: '이번 주 신메뉴를 소개합니다.\n\n#신메뉴 #오픈',
  media: [
    {
      id: 'dev-media-1',
      position: 1,
      mimeType: 'image/jpeg',
      altText: '신메뉴 사진',
      src: SAMPLE_PHOTO.landscape,
    },
  ],
  issues: [],
}

export function WorkPreviewHarness({
  enabled,
  hasSnapshot,
  photo = 'landscape',
}: Readonly<{ enabled: boolean; hasSnapshot: boolean; photo?: 'landscape' | 'square' }>) {
  const snapshot: ApprovalPreviewSnapshot = {
    ...SNAPSHOT,
    media: SNAPSHOT.media.map((m) => ({ ...m, src: SAMPLE_PHOTO[photo] })),
  }
  return (
    <main className="min-h-dvh bg-muted/40">
      <MobileR2Provider enabled={enabled}>
        {/*
          예시 사진은 이 워크스페이스의 media 자산이 아니므로 ACTUAL 로 두면 fail-closed 로 막힌다.
          하네스는 실데이터가 아니므로 예시 모드를 넘겨 화면에 예시 라벨이 붙게 한다.
        */}
        <WorkPreviewEntry snapshot={hasSnapshot ? snapshot : null} datasetMode="SHOWCASE_DEMO">
          <div data-legacy-work-detail className="p-4 text-sm text-muted-foreground">
            기존 작업 상세 화면(플래그 OFF 또는 넓은 화면)
          </div>
        </WorkPreviewEntry>
      </MobileR2Provider>
    </main>
  )
}
