import { notFound } from 'next/navigation'
import { TodayLayoutPreview } from './preview'

export const dynamic = 'force-dynamic'

/** 실제 오늘 홈(TodayLayout)을 고정 예시 값으로 보여주는 개발 전용 화면. 운영 404, 로그인·조회 없음. */
export default function TodayLayoutPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <TodayLayoutPreview />
}
