import { notFound } from 'next/navigation'
import { ConversationPublishingWorkflow } from '@/features/chat/conversation-publishing-workflow'
import { NaverRankCard } from '@/components/home-today/naver-rank-card'

export default async function NaverBlockRevisionPreview({ searchParams }: { searchParams: Promise<{ readiness?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const readiness = (await searchParams).readiness === 'ready' ? 'ready' : 'not_ready'
  return <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
    <h1>네이버 문단 수정 · 화면 검증</h1>
    <p>테스트 전용 원고입니다. 실제 가게·승인·게시 증거가 아니며 운영 저장 검증은 포함하지 않습니다. 저장 버튼은 실제 서버 권한 검사를 거칩니다.</p>
    <NaverRankCard workspaceId="10000000-0000-4000-8000-000000000001" />
    <ConversationPublishingWorkflow initialState={{
      role: 'owner', receipt: null,
      preview: {
        workspaceId: '10000000-0000-4000-8000-000000000001',
        contentId: '20000000-0000-4000-8000-000000000001',
        versionId: '30000000-0000-4000-8000-000000000001', versionNumber: 1,
        fingerprint: '1'.repeat(64), channel: 'naver_blog', visibility: 'private', naverRevisionReadiness: readiness,
        approval: { id: null, status: 'unreviewed', fingerprint: null },
        account: { connectionId: null, label: '검증용 예시', status: 'disconnected' },
        caption: '방문 전 상담 항목을 확인해 주세요.', hashtags: ['#상담안내'], disclosure: '테스트 예시',
        text: '방문 전 상담 항목을 확인해 주세요.',
        naverCopy: {
          title: '상담 전 확인할 내용', introduction: '방문 전 상담 항목을 확인해 주세요.',
          sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }], keywords: ['상담안내'], cta: '상담 가능 여부를 문의해 주세요.',
        },
        naverBlocks: [
          { kind: 'paragraph', text: '방문 전 상담 항목을 확인해 주세요.' },
          { kind: 'heading', text: '준비할 내용' },
          { kind: 'paragraph', text: '궁금한 점을 미리 정리해 주세요.' },
          { kind: 'image', mediaId: '50000000-0000-4000-8000-000000000001', altText: '테스트 사진' },
        ],
        media: [{ id: '50000000-0000-4000-8000-000000000001', position: 1, mimeType: 'image/webp', altText: '테스트 사진', src: '/images/sohee-planning-bakery.webp' }],
        issues: [{ code: 'channel_disconnected', message: '테스트 화면은 게시 계정과 연결하지 않습니다.' }],
      },
    }} />
  </main>
}
