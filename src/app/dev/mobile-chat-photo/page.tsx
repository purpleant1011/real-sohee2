import { notFound } from 'next/navigation'

import { MobileChatPhotoPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * 채팅 사진 첨부 검수용 개발 페이지 (refs ANI-1687).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/업로드/외부 요청 없음.
 *
 * /dev/mobile-chat-photo
 */
export default function MobileChatPhotoPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh bg-muted/40">
      <MobileChatPhotoPreview />
    </main>
  )
}
