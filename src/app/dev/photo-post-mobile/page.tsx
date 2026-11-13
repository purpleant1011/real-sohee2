import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { PhotoPostMobilePreview } from './preview'

export const dynamic = 'force-dynamic'

/** 모바일 390px 뷰포트 "사진으로 글 만들기" 시각 검증 및 감사 전용 하네스 (운영 404) */
export default function PhotoPostMobilePage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <Suspense fallback={null}>
      <PhotoPostMobilePreview />
    </Suspense>
  )
}
