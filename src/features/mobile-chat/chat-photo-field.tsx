'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Camera, X } from 'lucide-react'

import {
  CHAT_PHOTO_ACCEPT,
  CHAT_PHOTO_LOCAL_ONLY_NOTICE,
  chatPhotoCountLabel,
  createPreviewUrl,
  isChatPhotoFull,
  MAX_CHAT_PHOTOS,
  photoKey,
  planChatPhotos,
  revokePreviewUrl,
  type ChatPhotoRejection,
} from './attachment-preview'

export interface ChatPhotoAttachment {
  id: string
  name: string
  size: number
  /** 브라우저가 미리보기 URL 을 못 만들면 null. 그때는 사진을 그린 척하지 않는다. */
  previewUrl: string | null
}

export interface ChatPhotoFieldProps {
  /** 붙인 사진이 바뀔 때마다 호출된다. 업로드는 하지 않는다. */
  onChange?: (photos: readonly ChatPhotoAttachment[]) => void
  disabled?: boolean
  max?: number
}

const CONTROL =
  'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium focus-within:outline-2 focus-within:outline-ring'

/**
 * 사진 첨부 입력 — 로컬 미리보기까지만.
 *
 * 정직성 규칙:
 * - 미리보기 URL 을 만들지 못하면 사진을 그린 척하지 않고 파일 이름만 보여 준다.
 * - 보내기가 연결되지 않았다는 사실을 항상 적어 둔다.
 * - 거절 사유는 서버 계약과 같은 `classifyPhotoFile` 문구를 그대로 쓴다.
 */
export function ChatPhotoField({
  onChange,
  disabled = false,
  max = MAX_CHAT_PHOTOS,
}: ChatPhotoFieldProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const seq = useRef(0)
  const urls = useRef<string[]>([])

  const [photos, setPhotos] = useState<ChatPhotoAttachment[]>([])
  const [rejected, setRejected] = useState<ChatPhotoRejection[]>([])

  useEffect(() => {
    const created = urls
    return () => {
      for (const url of created.current) revokePreviewUrl(url)
      created.current = []
    }
  }, [])

  const full = isChatPhotoFull(photos.length, max)
  const pickerDisabled = disabled || full

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    // 같은 사진을 다시 고를 수 있도록 입력값을 비운다.
    event.target.value = ''
    if (picked.length === 0) return

    const plan = planChatPhotos(picked, photos.length, max, photos.map(photoKey))

    const added = plan.accepted.map(file => {
      const previewUrl = createPreviewUrl(file)
      if (previewUrl !== null) urls.current.push(previewUrl)
      seq.current += 1
      return {
        id: `chat-photo-${seq.current}`,
        name: file.name,
        size: file.size,
        previewUrl,
      }
    })

    const next = [...photos, ...added]
    setPhotos(next)
    setRejected(plan.rejected)
    onChange?.(next)
  }

  function remove(id: string) {
    const target = photos.find(photo => photo.id === id)
    if (!target) return

    revokePreviewUrl(target.previewUrl)
    urls.current = urls.current.filter(url => url !== target.previewUrl)

    const next = photos.filter(photo => photo.id !== id)
    setPhotos(next)
    setRejected([])
    onChange?.(next)
  }

  return (
    <div data-chat-photo-field className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={CHAT_PHOTO_ACCEPT}
          multiple
          disabled={pickerDisabled}
          onChange={handleChange}
          className="sr-only"
        />
        <label
          htmlFor={inputId}
          aria-disabled={pickerDisabled ? 'true' : undefined}
          className={
            pickerDisabled
              ? `${CONTROL} cursor-not-allowed text-muted-foreground opacity-50`
              : `${CONTROL} cursor-pointer text-foreground`
          }
        >
          <Camera className="size-4" aria-hidden="true" />
          사진 붙이기
        </label>
        <span className="text-xs text-muted-foreground">
          {chatPhotoCountLabel(photos.length, max)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {CHAT_PHOTO_LOCAL_ONLY_NOTICE}
      </p>

      {/*
        알림 영역은 항상 마운트해 둔다. 내용과 함께 새로 삽입하면 스크린리더가
        읽지 않는 경우가 있어, 거절이 생길 때 내용만 바뀌도록 한다.
      */}
      <div
        role="alert"
        className={
          rejected.length > 0
            ? 'rounded-xl border border-border bg-card p-3'
            : 'sr-only'
        }
      >
        {rejected.length > 0 ? (
          <ul className="space-y-1">
            {rejected.map(item => (
              <li key={`${item.name}:${item.message}`} className="text-sm leading-relaxed">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground">: {item.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {photos.length > 0 ? (
        <ul aria-label="붙인 사진" className="flex flex-wrap gap-3">
          {photos.map(photo => (
            <li key={photo.id} data-chat-photo={photo.id} className="relative">
              {photo.previewUrl !== null ? (
                // 로컬 object URL 이라 next/image 최적화 대상이 아니다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.previewUrl}
                  alt={`붙인 사진: ${photo.name}`}
                  className="size-20 rounded-xl border border-border object-cover"
                />
              ) : (
                <div className="flex size-20 items-center justify-center rounded-xl border border-border bg-muted p-2 text-center text-xs leading-snug break-all">
                  {photo.name}
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(photo.id)}
                disabled={disabled}
                aria-label={`${photo.name} 빼기`}
                className="absolute -right-2 -top-2 inline-flex size-11 items-center justify-center rounded-full border border-border bg-background text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
