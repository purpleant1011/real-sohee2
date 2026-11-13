import { notFound } from 'next/navigation'
import { LiveStudio } from './live-studio'

export const dynamic = 'force-dynamic'

/** 실제 모델로 4채널 스튜디오를 체험하는 개발 전용 화면. 운영에서는 404. */
export default function ChannelStudioLiveDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="min-w-0 bg-background px-3 py-6 sm:px-8">
      <h1 className="sr-only">4채널 글 만들기 라이브 체험</h1>
      <LiveStudio />
    </main>
  )
}
