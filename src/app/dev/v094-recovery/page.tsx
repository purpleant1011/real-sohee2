import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AdsView } from '@/app/app/ads/ads-view'
import { WorkDetail } from '@/features/content/work-detail'
import { RecoveryListPreview, MissionContinuationPreview, InterviewQuestionPreview, OriginalPhotoRecoveryPreview, HomePhotoPreparationPreview, SettingsSourcePreview, NotificationsReturnPreview, CustomerReviewPreview, PreviewThemeControl, DesktopReviewPreview } from './preview'

const workspaceId = '10000000-0000-4000-8000-000000000001'

export default async function RecoveryPreview({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await searchParams
  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex flex-wrap gap-4 border-b p-4 text-sm">
      <strong>TEST · 합성 자료 · 실제 매장·게시·예약 연결 없음</strong>
      <PreviewThemeControl />
      <Link href="/dev/v094-recovery">작업 목록</Link>
      <Link href="/dev/v094-recovery?screen=detail">옛 초안 상세</Link>
      <Link href="/dev/v094-recovery?screen=ads">광고 권한 미확인</Link>
      <Link href="/dev/v094-recovery?screen=mission">임무 대화 인계</Link>
      <Link href="/dev/v094-recovery?screen=question">질문 중복 확인</Link>
      <Link href="/dev/v094-recovery?screen=photo-recovery">원본 사진 복구 안내</Link>
      <Link href="/dev/v094-recovery?screen=home-photo">홈 사진 준비</Link>
      <Link href="/dev/v094-recovery?screen=settings-source">더보기 조회 근거</Link>
      <Link href="/dev/v094-recovery?screen=notifications-return&kind=publish">알림 게시 필터 복원</Link>
      <Link href="/dev/v094-recovery?screen=customer-review">문의·예약 안전 인계</Link>
      <Link href="/dev/v094-recovery?screen=desktop-review">PC 대화 검토</Link>
    </header>
    {screen === 'desktop-review' ? <DesktopReviewPreview /> : screen === 'settings-source' ? <SettingsSourcePreview /> : screen === 'notifications-return' ? <NotificationsReturnPreview /> : screen === 'customer-review' ? <CustomerReviewPreview /> : screen === 'home-photo' ? <HomePhotoPreparationPreview /> : screen === 'photo-recovery' ? <OriginalPhotoRecoveryPreview /> : screen === 'question' ? <InterviewQuestionPreview /> : screen === 'mission' ? <MissionContinuationPreview /> : screen === 'ads' ? <AdsView workspaceId={workspaceId} /> : screen === 'detail' ? <WorkDetail detail={{
      id: '20000000-0000-4000-8000-000000000001', title: '확인 근거가 없는 옛 초안', channel: 'threads', status: 'draft',
      currentVersionId: null, currentVersionNumber: null, source: 'actual', createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z',
      versions: [{ id: '30000000-0000-4000-8000-000000000001', versionNumber: 1, caption: '이 본문은 저장되어 있어요. 권리와 생성 근거 확인 전에는 게시하지 않아요.',
        hashtags: ['#예시'], disclosure: '', fingerprint: 'a'.repeat(64), revisionReason: null, createdAt: '2026-11-02T10:00:00Z',
        rightsConfirmed: false, generationEvidenceConfirmed: false, mediaCount: 0, media: [], structuredPayload: null, knowledgeIds: [], harnessRuleIds: [] }],
    }} /> : <RecoveryListPreview />}
  </main>
}
