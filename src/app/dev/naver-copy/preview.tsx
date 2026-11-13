'use client'

import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { BlogArtifactPreview } from '@/features/chat/blog-artifact-preview'
import type { ConversationArtifact } from '@/features/chat/types'

const artifact: ConversationArtifact = {
  id: '33333333-3333-4333-8333-333333333333',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  sourceMessageId: '44444444-4444-4444-8444-444444444444',
  contentItemId: '55555555-5555-4555-8555-555555555555',
  versionId: '66666666-6666-4666-8666-666666666666',
  type: 'naver_blog_post',
  status: 'ready_for_review',
  title: '청라 자연눈썹 시술 전 꼭 확인할 3가지',
  caption: '',
  hashtags: ['#청라자연눈썹', '#반영구'],
  cta: '궁금한 점은 프로필 링크로 편하게 문의하세요.',
  disclosure: '본 게시물은 고객 사전 상담 기준을 바탕으로 작성되었습니다.',
  observations: [], limitations: [], evidence: ['25년 경력 원장 1:1 상담 기준'], unresolvedQuestions: [],
  idempotencyKey: 'dev-preview-key',
  slides: [
    { id: 's1', position: 1, role: 'cover', status: 'succeeded', mediaAssetId: '77777777-7777-4777-8777-777777777777', altText: '시술 전 상담 매장 전경', retryable: false, safeErrorCode: null },
    { id: 's2', position: 2, role: 'detail', status: 'succeeded', mediaAssetId: '88888888-8888-4888-8888-888888888888', altText: '맞춤 디자인 결 정리 사진', retryable: false, safeErrorCode: null },
  ],
  naverBlog: {
    introduction: '첫인상을 좌우하는 눈썹 디자인, 내 얼굴 골격에 맞는 결을 찾는 것이 가장 중요합니다.',
    sections: [
      { heading: '1. 내 얼굴형에 맞는 자연스러운 결 디자인', body: '기계적인 일자 눈썹이 아닌, 본인의 이마 근육과 눈썹 뼈 돌출도에 맞춰 한 올 한 올 디자인을 잡아야 어색하지 않습니다.' },
      { heading: '2. 시술 직후와 탈각 후의 색감 차이 이해하기', body: '첫날 진해 보이는 것은 자연스러운 과정이며, 일주일 뒤 자연스러운 본연의 색으로 안정됩니다.' },
    ],
    editorBlueprint: [
      { kind: 'paragraph', text: '첫인상을 좌우하는 눈썹 디자인, 내 얼굴 골격에 맞는 결을 찾는 것이 가장 중요합니다.' },
      { kind: 'image_slot', position: 1, altText: '시술 전 상담 매장 전경' },
      { kind: 'heading', text: '1. 내 얼굴형에 맞는 자연스러운 결 디자인' },
      { kind: 'paragraph', text: '기계적인 일자 눈썹이 아닌, 본인의 이마 근육과 눈썹 뼈 돌출도에 맞춰 한 올 한 올 디자인을 잡아야 어색하지 않습니다.' },
      { kind: 'image_slot', position: 2, altText: '맞춤 디자인 결 정리 사진' },
      { kind: 'heading', text: '2. 시술 직후와 탈각 후의 색감 차이 이해하기' },
      { kind: 'paragraph', text: '첫날 진해 보이는 것은 자연스러운 과정이며, 일주일 뒤 자연스러운 본연의 색으로 안정됩니다.' },
      { kind: 'cta', text: '궁금한 점은 프로필 링크로 편하게 문의하세요.' },
    ],
    keywords: ['청라자연눈썹', '반영구눈썹', '청라뷰티샵'],
    visibility: 'public',
  },
}

function InnerPreview() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="max-w-xl mx-auto p-2 sm:p-4 space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>테마 전환</Button>
      </div>
      <BlogArtifactPreview artifact={artifact} />
    </div>
  )
}

export function NaverCopyPreview() {
  return (
    <ThemeProvider storageKey="sohee-naver-copy-preview-theme">
      <InnerPreview />
    </ThemeProvider>
  )
}
