import { notFound } from 'next/navigation'
import { FourChannelStudio } from '@/features/channel-studio/ui/four-channel-studio'
import { SAMPLE_CAFE_DRAFT } from '@/features/channel-studio/ui/sample-draft'

export const dynamic = 'force-dynamic'

/** 실제 4채널 스튜디오 컴포넌트를 고정 샘플로 보는 개발 전용 화면. 운영에서는 404. */
export default function ChannelStudioComponentDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-w-0 bg-background px-3 py-6 sm:px-8">
      <h1 className="sr-only">4채널 글 만들기 미리보기 화면</h1>
      <FourChannelStudio workspaceId="dev-sample" initialDraft={SAMPLE_CAFE_DRAFT} />
    </main>
  )
}
