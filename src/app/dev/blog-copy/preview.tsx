'use client'

import { BlogArtifactPreview } from '@/features/chat/blog-artifact-preview'
import type { ConversationArtifact } from '@/features/chat/types'
import { ManagerCockpitBriefing } from '@/components/v087/cockpit/ManagerCockpitBriefing'
import type { RevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model'

const artifact = {
  id: '77777777-7777-4777-8777-777777777777', workspaceId: '11111111-1111-4111-8111-111111111111',
  sourceMessageId: '66666666-6666-4666-8666-666666666666', type: 'naver_blog_post', status: 'ready_for_review',
  caption: '', title: '첫 방문 전 확인할 상담 안내',
  naverBlog: {
    introduction: '방문 전 상담 항목을 확인해 주세요.',
    sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }],
    editorBlueprint: [
      { kind: 'paragraph', text: '방문 전 상담 항목을 확인해 주세요.' },
      { kind: 'image_slot', position: 1, altText: '매장 입구 사진' },
      { kind: 'heading', text: '준비할 내용' },
      { kind: 'paragraph', text: '궁금한 점을 미리 정리해 주세요.' },
      { kind: 'cta', text: '상담 가능 여부를 문의해 주세요.' },
    ],
    keywords: ['상담안내', '첫방문'], visibility: 'private',
  },
  hashtags: [], cta: '', disclosure: '', observations: [], limitations: [], evidence: ['테스트 가게 정보: 상담 후 안내합니다.'],
  unresolvedQuestions: [], idempotencyKey: 'dev', slides: [],
} as unknown as ConversationArtifact

export function BlogCopyPreview({ missingSource }: { missingSource: RevenueCommandReadModel }) {
  return <>
    <section aria-label="미관측 엔진 통합 검증" className="mb-6 flex flex-col gap-3">
      <p>테스트 식별자로 연결되지 않은 원장을 확인해요. 저장·외부 게시를 실행하지 않아요.</p>
      <ManagerCockpitBriefing workspaceId={artifact.workspaceId} data={missingSource} />
    </section>
    <BlogArtifactPreview artifact={artifact} />
  </>
}
