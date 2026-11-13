import { notFound } from 'next/navigation'

import { MobileChatLongFormPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * 긴 원고 표시·입력 검수용 개발 페이지 (refs ANI-1687).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/전송/외부 요청 없음.
 *
 * /dev/mobile-chat-long-form
 */
export default function MobileChatLongFormPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <MobileChatLongFormPreview />
    </main>
  )
}
