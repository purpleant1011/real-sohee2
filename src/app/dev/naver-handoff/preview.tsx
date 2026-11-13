'use client'

import { NaverPostForm } from '@/features/channel-studio/naver/ui/naver-post-form'
import { NaverGeneratingState } from '@/features/channel-studio/naver/ui/naver-generating-state'
import { NaverOneShotCard } from '@/features/channel-studio/naver/ui/naver-one-shot-card'
import { NaverStepList } from '@/features/channel-studio/naver/ui/naver-step-list'
import type { NaverPostForCopy } from '@/features/channel-studio/naver/copy-naver-post'
import type { NaverStep } from '@/features/channel-studio/naver/naver-step-sequence'

const svg = (c: string, n: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${c}"/><text x="200" y="170" font-size="90" text-anchor="middle" fill="#fff">${n}</text></svg>`)}`
const colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400']
const ids = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const post: NaverPostForCopy = {
  title: '청라 바이름 첫 방문 전 공간 둘러보기',
  introduction: '첫 방문을 앞두고 낯선 공간이 궁금하셨을 분들을 위해 차분하게 둘러보세요.',
  sections: [{ heading: '공간', body: '정돈된 공간입니다.' }],
  keywords: ['청라눈썹문신', '바이름청라점', '자연눈썹'],
  cta: '궁금한 점은 편하게 문의해 주세요.',
  editorBlocks: ids.flatMap((id, i) => [
    { kind: 'paragraph' as const, text: `사진 ${i + 1} 설명 문장입니다. 장면과 분위기를 차분하게 소개해요.` },
    { kind: 'image' as const, mediaId: id, altText: `사진 ${i + 1}` },
  ]),
  media: ids.map((id, i) => ({ id, src: svg(colors[i % 5], i + 1) })),
}
const photoSteps: readonly NaverStep[] = [
  { type: 'title', text: post.title },
  { type: 'text', segmentIndex: 1, segmentCount: 2, text: '소개 문단입니다.' },
  { type: 'image', photoIndex: 1, mediaId: ids[0], src: svg('#c0392b', 1), alt: '사진 1', positionHint: '소개 뒤' },
  { type: 'text', segmentIndex: 2, segmentCount: 2, text: '마무리 문단입니다.' },
  { type: 'tags', text: '#청라눈썹문신 #바이름청라점', count: 2 },
]
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const assets = { photoCount: 15, files: [], skippedPhotos: 0 } as never
const ok = {
  prepare: async () => { await wait(1500); return assets },
  copy: async () => ({ status: 'ok', photos: 15 }) as const,
  share: async () => 'shared' as const,
}

export function NaverHandoffPreview() {
  return (
    <main className="mx-auto max-w-3xl min-w-0 space-y-10 px-4 py-6">
      <h1 className="text-lg font-bold">네이버 수동 포스팅 UI 점검 (개발 전용)</h1>
      <section aria-label="A 글 만들기 폼" id="a-form" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">A. 글 만들기 폼</h2>
        <NaverPostForm onSubmit={() => undefined} businessProfile={{ businessName: '바이름 청라점', industry: '반영구' }} />
      </section>
      <section aria-label="B 생성 중" id="b-gen" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">B. 생성 중</h2>
        <NaverGeneratingState topic="바이름 청라점 첫 방문 전 공간 둘러보기" imageCount={15} onCancel={() => undefined} />
      </section>
      <section aria-label="C 생성 실패" id="c-fail" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">C. 생성 실패(확인 필요 표현)</h2>
        <NaverGeneratingState topic="바이름 청라점" imageCount={20} onCancel={() => undefined} error={{ message: 'x', errorCode: 'CLAIMS_NEED_REVIEW' }} onRetry={() => undefined} />
      </section>
      <section aria-label="D 원샷 카드 모바일" id="d-oneshot" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">D. 원샷 카드 (모바일 동작)</h2>
        <NaverOneShotCard post={post} cacheKey="dev-d" deps={{ ...ok, isDesktop: false }} />
      </section>
      <section aria-label="E 원샷 카드 PC" id="e-oneshot-pc" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">E. 원샷 카드 (PC 동작)</h2>
        <NaverOneShotCard post={post} cacheKey="dev-e" deps={{ ...ok, share: async () => 'unsupported', isDesktop: true }} onDownloadZip={async () => { await wait(800) }} />
      </section>
      <section aria-label="F 단계 목록" id="f-steps" className="space-y-2"><h2 className="text-sm font-semibold text-muted-foreground">F. 한 조각씩(자세히)</h2>
        <NaverStepList steps={photoSteps} postMode="information" />
      </section>
    </main>
  )
}
