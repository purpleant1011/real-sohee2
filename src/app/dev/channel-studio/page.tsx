import { notFound } from 'next/navigation'
import { SampleGallery } from './sample-gallery'
import { SAMPLE_CAFE_DRAFT } from '@/features/channel-studio/ui/sample-draft'

export const dynamic = 'force-dynamic'

/**
 * 4채널 스튜디오 실측·증거용 개발 페이지 (ANI-1538).
 * 개발 환경에서만 열리며 운영(production) 환경에서는 404를 반환합니다.
 * 추후 FourChannelStudio 컴포넌트 병합 시 initialDraft={SAMPLE_CAFE_DRAFT}로 교체할 수 있습니다.
 */
export default function ChannelStudioDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-w-0 bg-background px-4 py-8 sm:px-8">
      <SampleGallery initialDraft={SAMPLE_CAFE_DRAFT} />
    </main>
  )
}
