import { notFound } from 'next/navigation'
import { MobileChatSafeAreaPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * M10 채팅 키보드·safe-area 로컬 증거 화면 (ANI-1687).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-chat-safe-area
 */
export default function MobileChatSafeAreaDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="min-h-dvh bg-muted/40">
      <MobileChatSafeAreaPreview />
    </div>
  )
}
