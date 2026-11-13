import { notFound } from 'next/navigation'
import { MobileChatRedesignPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * M10 모바일 "대화" 화면 재설계 검수 하네스.
 * 개발 환경 전용 — 인증 없이 전체 셸 + 단일 헤더 + 허브 + 컴포저 통합 인터랙션을 검증.
 *
 * /dev/mobile-chat-redesign
 */
export default function MobileChatRedesignDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="min-h-dvh bg-muted/20">
      <MobileChatRedesignPreview />
    </div>
  )
}
