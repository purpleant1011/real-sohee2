import { notFound } from 'next/navigation'
import { CommonErrorDemo } from './demo'

export const dynamic = 'force-dynamic'

/**
 * 공통 에러·수신 동의 프리뷰. 개발 전용(운영 404). /dev/mobile-r2/common-error
 * 예시 데이터만 쓰고 서버 조회·외부 요청은 보내지 않는다.
 */
export default function CommonErrorPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-6">
      <CommonErrorDemo />
    </main>
  )
}
