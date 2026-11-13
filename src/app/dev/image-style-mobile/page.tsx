import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ImageStyleSettings } from '@/features/image-style/image-style-settings'

/** 모바일 390px 뷰포트 시각 검증 및 감사 전용 하네스 (운영 404) */
export default function ImageStyleMobileDevPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center py-4 px-2 sm:px-4">
      <div className="w-full max-w-[390px] min-w-[320px] flex flex-col bg-background border border-border/70 rounded-2xl shadow-sm overflow-hidden">
        {/* 모바일 셸 모의 헤더 */}
        <header className="flex h-14 items-center justify-between border-b border-border/60 px-3 bg-card/80 backdrop-blur sticky top-0 z-30">
          <Link
            href="/dev/mobile-r2/app"
            className="inline-flex size-10 items-center justify-center rounded-xl text-foreground hover:bg-muted active:scale-95 transition-all"
            aria-label="더보기로 돌아가기"
          >
            <ChevronLeft className="size-6" />
          </Link>
          <h1 className="text-base font-semibold tracking-tight text-foreground">이미지 스타일</h1>
          <div className="size-10" aria-hidden="true" />
        </header>

        {/* 본문 — 단일 모바일 인셋 16px */}
        <main className="flex-1 p-4">
          <ImageStyleSettings
            canEdit
            workspaceId="11111111-1111-4111-8111-111111111111"
            initialStyle={{
              subject: '꽃다발과 계절 소품의 디테일',
              composition: '제품을 중앙에 두고 여백 확보',
              setting: '밝은 매장 진열대',
              mood: '싱그럽고 자연스러운',
              lookAndColor: '부드러운 자연광, 화사한 톤',
              people: 'hands',
              avoid: ['과한 보정', '네온 조명'],
              extra: '',
              guide: '제품은 항상 화면 중앙에 두고 여백을 충분히 살려주세요.',
              referenceAssetIds: [],
              referenceNotes: {},
            }}
          />
        </main>
      </div>
    </div>
  )
}
