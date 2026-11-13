'use client'

import { useState } from 'react'

import { ChatPhotoField, type ChatPhotoAttachment } from '@/features/mobile-chat/chat-photo-field'
import { ChatComposer } from '@/features/mobile-chat/chat-parts'

/**
 * 사진 첨부 입력 검수용 미리보기. 서버 호출·업로드 없이 로컬 미리보기만 확인한다.
 * 화면 문구가 '예시'임을 숨기지 않는다.
 */
export function MobileChatPhotoPreview() {
  const [draft, setDraft] = useState('')
  const [photos, setPhotos] = useState<readonly ChatPhotoAttachment[]>([])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col bg-background">
      <div className="flex-1 space-y-4 px-4 py-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">사진 붙이기 검수 화면</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            예시 화면이에요. 고른 사진은 서버로 보내지 않고 이 브라우저에서만 미리 보여요.
          </p>
        </header>

        <ChatPhotoField onChange={setPhotos} />

        <section aria-label="선택 결과" className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-medium">붙인 사진 {photos.length}장</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            이 화면은 화면 상태만 확인하는 용도예요. 실제 전송은 연결되어 있지 않아요.
          </p>
        </section>
      </div>

      <ChatComposer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} />
    </div>
  )
}
