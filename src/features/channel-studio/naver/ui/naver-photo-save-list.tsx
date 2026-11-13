'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type NaverPhotoItem = Readonly<{
  id: string
  src: string
  alt: string
}>

export type NaverPhotoSaveListProps = Readonly<{
  photos: readonly NaverPhotoItem[]
}>

type PhotoState =
  | { status: 'loading' }
  | {
      status: 'ready'
      file: File
      objectUrl: string
      filename: string
    }
  | { status: 'error' }

type MessageState =
  | { type: 'status'; text: string }
  | { type: 'alert'; text: string }

function executeSavePhoto({
  file,
  objectUrl,
  filename,
  onMessage,
  onClearMessage,
  onSuccess,
}: {
  file: File
  objectUrl: string
  filename: string
  onMessage: (msg: MessageState) => void
  onClearMessage: () => void
  onSuccess?: () => void
}) {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] }) &&
    typeof navigator.share === 'function'
  ) {
    onMessage({
      type: 'status',
      text: '공유 화면에서 "이미지 저장"을 눌러 주세요.',
    })

    navigator
      .share({ files: [file] })
      .then(() => {
        onMessage({
          type: 'status',
          text: '저장 화면을 열었어요.',
        })
        onSuccess?.()
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          onClearMessage()
          return
        }
        onMessage({
          type: 'alert',
          text: '이 사진을 저장하지 못했어요. 다시 시도하거나 ZIP으로 받아 주세요.',
        })
      })
  } else if (typeof document !== 'undefined') {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()

    onMessage({
      type: 'status',
      text: '다운로드를 시작했어요. 파일 앱 또는 다운로드 목록을 확인해 주세요.',
    })
    onSuccess?.()
  }
}

export function NaverPhotoSaveList({ photos }: NaverPhotoSaveListProps) {
  // 부모가 렌더마다 새 배열을 만들어 넘겨도 내용이 같으면 다시 내려받지 않는다.
  const signature = photos.map((photo) => `${photo.id}|${photo.src}`).join('\n')
  const [prevSignature, setPrevSignature] = useState(signature)
  const [photoStates, setPhotoStates] = useState<Readonly<Record<string, PhotoState>>>({})
  const [messages, setMessages] = useState<Readonly<Record<string, MessageState>>>({})

  if (prevSignature !== signature) {
    setPrevSignature(signature)
    setPhotoStates({})
    setMessages({})
  }

  useEffect(() => {
    if (!photos.length) {
      return
    }

    let cancelled = false
    const abortController = new AbortController()
    const createdUrls: string[] = []

    let nextIndex = 0
    const total = photos.length

    async function worker(): Promise<void> {
      while (nextIndex < total) {
        if (cancelled) return
        const currentIndex = nextIndex++
        const photo = photos[currentIndex]

        try {
          const response = await fetch(photo.src, { signal: abortController.signal })
          if (!response.ok) {
            throw new Error(`fetch_failed_${response.status}`)
          }
          const blob = await response.blob()
          if (cancelled) return

          const mime = blob.type || 'image/jpeg'
          const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
          const filename = `photo-${currentIndex + 1}.${ext}`
          const file = new File([blob], filename, { type: mime })
          const objectUrl = URL.createObjectURL(blob)
          createdUrls.push(objectUrl)

          if (!cancelled) {
            setPhotoStates((prev) => ({
              ...prev,
              [photo.id]: {
                status: 'ready',
                file,
                objectUrl,
                filename,
              },
            }))
          } else {
            URL.revokeObjectURL(objectUrl)
          }
        } catch (err: unknown) {
          if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
            return
          }
          if (!cancelled) {
            setPhotoStates((prev) => ({
              ...prev,
              [photo.id]: { status: 'error' },
            }))
            setMessages((prev) => ({
              ...prev,
              [photo.id]: {
                type: 'alert',
                text: '이 사진을 저장하지 못했어요. 다시 시도하거나 ZIP으로 받아 주세요.',
              },
            }))
          }
        }
      }
    }

    const concurrency = Math.min(2, total)
    const workers = Array.from({ length: concurrency }, () => worker())
    void Promise.all(workers)

    return () => {
      cancelled = true
      abortController.abort()
      createdUrls.forEach((url) => {
        URL.revokeObjectURL(url)
      })
    }
    // photos 는 signature 가 바뀔 때만 의미가 달라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  if (!photos.length) return null

  function handleSavePhoto(photo: NaverPhotoItem) {
    const item = photoStates[photo.id]
    if (!item || item.status !== 'ready') return

    executeSavePhoto({
      file: item.file,
      objectUrl: item.objectUrl,
      filename: item.filename,
      onMessage: (msg) => setMessages((prev) => ({ ...prev, [photo.id]: msg })),
      onClearMessage: () => {
        setMessages((prev) => {
          const next = { ...prev }
          delete next[photo.id]
          return next
        })
      },
    })
  }

  return (
    <div className="col-span-full space-y-2.5 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <p className="text-xs text-muted-foreground">
        사진은 하나씩 저장하거나 ZIP으로 한꺼번에 받을 수 있어요.
      </p>
      <div className="space-y-2">
        {photos.map((photo, idx) => {
          const item = photoStates[photo.id]
          const isReady = item?.status === 'ready'
          const isLoading = !item || item.status === 'loading'
          const message = messages[photo.id]
          const label = `사진 ${idx + 1} 저장`

          return (
            <div key={photo.id} className="space-y-1">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2 sm:p-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.src}
                    alt={photo.alt}
                    loading="lazy"
                    className="size-11 sm:size-12 shrink-0 rounded-md border object-cover bg-muted"
                  />
                  <span className="text-xs text-foreground truncate font-medium">
                    {photo.alt || `사진 ${idx + 1}`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isReady}
                  aria-busy={isLoading ? true : undefined}
                  aria-label={label}
                  onClick={() => handleSavePhoto(photo)}
                  className="min-h-11 shrink-0 px-3 text-xs font-semibold"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                      <span>준비 중…</span>
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5 mr-1.5" aria-hidden="true" />
                      <span>{label}</span>
                    </>
                  )}
                </Button>
              </div>
              {message ? (
                message.type === 'alert' ? (
                  <p role="alert" className="text-xs text-destructive px-1">
                    {message.text}
                  </p>
                ) : (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-xs text-muted-foreground px-1"
                  >
                    {message.text}
                  </p>
                )
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type NaverSinglePhotoSaveProps = Readonly<{
  photo: NaverPhotoItem
  photoIndex?: number
  positionHint?: string
  onSaved?: () => void
}>

export function NaverSinglePhotoSave({
  photo,
  photoIndex = 1,
  positionHint,
  onSaved,
}: NaverSinglePhotoSaveProps) {
  const [photoState, setPhotoState] = useState<PhotoState>({ status: 'loading' })
  const [message, setMessage] = useState<MessageState | null>(null)

  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()
    let createdUrl: string | null = null

    async function preparePhoto() {
      try {
        const response = await fetch(photo.src, { signal: abortController.signal })
        if (!response.ok) {
          throw new Error(`fetch_failed_${response.status}`)
        }
        const blob = await response.blob()
        if (cancelled) return

        const mime = blob.type || 'image/jpeg'
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
        const filename = `photo-${photoIndex}.${ext}`
        const file = new File([blob], filename, { type: mime })
        const objectUrl = URL.createObjectURL(blob)
        createdUrl = objectUrl

        if (!cancelled) {
          setPhotoState({
            status: 'ready',
            file,
            objectUrl,
            filename,
          })
        } else {
          URL.revokeObjectURL(objectUrl)
        }
      } catch (err: unknown) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return
        if (!cancelled) {
          setPhotoState({ status: 'error' })
          setMessage({
            type: 'alert',
            text: '이 사진을 저장하지 못했어요. 다시 시도하거나 ZIP으로 받아 주세요.',
          })
        }
      }
    }

    void preparePhoto()

    return () => {
      cancelled = true
      abortController.abort()
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [photo.src, photoIndex])

  const isReady = photoState.status === 'ready'
  const isLoading = photoState.status === 'loading'
  const label = `사진 ${photoIndex} 저장`

  function handleSave() {
    if (photoState.status !== 'ready') return
    executeSavePhoto({
      file: photoState.file,
      objectUrl: photoState.objectUrl,
      filename: photoState.filename,
      onMessage: setMessage,
      onClearMessage: () => setMessage(null),
      onSuccess: onSaved,
    })
  }

  return (
    <div className="space-y-1.5 w-full">
      {positionHint ? (
        <p className="text-xs text-muted-foreground font-medium">
          {positionHint}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2 sm:p-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.src}
            alt={photo.alt || label}
            loading="lazy"
            className="size-11 sm:size-12 shrink-0 rounded-md border object-cover bg-muted"
          />
          <div className="min-w-0">
            <span className="text-xs text-foreground truncate font-medium block">
              {photo.alt || label}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isReady}
          aria-busy={isLoading ? true : undefined}
          aria-label={label}
          onClick={handleSave}
          className="min-h-11 shrink-0 px-3 text-xs font-semibold"
        >
          {isLoading ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              <span>준비 중…</span>
            </>
          ) : (
            <>
              <Download className="size-3.5 mr-1.5" aria-hidden="true" />
              <span>{label}</span>
            </>
          )}
        </Button>
      </div>
      {message ? (
        message.type === 'alert' ? (
          <p role="alert" className="text-xs text-destructive px-1">
            {message.text}
          </p>
        ) : (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground px-1">
            {message.text}
          </p>
        )
      ) : null}
    </div>
  )
}

