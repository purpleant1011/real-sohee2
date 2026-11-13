'use client'

import Image from 'next/image'
import { MapPin, PencilLine } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { NAVER_VISIBILITY_LABELS } from '@/features/naver-publish/types'
import { PreviewFrame } from '@/features/preview/preview-frame'
import styles from './channel-preview-card.module.css'

export type MediaReadinessStatus = Readonly<{
  total: number
  loaded: number
  failedPositions: readonly number[]
  ready: boolean
}>

export function ChannelPreviewCard({
  preview,
  onMediaReadinessChange,
  onMediaStatusChange,
  onEditCaption,
  onEditImage,
  retryRequest = 0,
}: Readonly<{
  preview: ApprovalPreviewSnapshot
  onMediaReadinessChange: (ready: boolean) => void
  onMediaStatusChange?: (status: MediaReadinessStatus) => void
  onEditCaption?: () => void
  onEditImage?: () => void
  retryRequest?: number
}>) {
  const card = <VersionedChannelPreviewCard
    key={`${preview.versionId}:${preview.fingerprint}:${preview.media.map((media) => media.id).join(',')}`}
    onMediaReadinessChange={onMediaReadinessChange}
    onMediaStatusChange={onMediaStatusChange}
    onEditCaption={onEditCaption}
    onEditImage={onEditImage}
    preview={preview}
    retryRequest={retryRequest}
  />
  // Preserve the existing Naver approval renderer (real saved blocks/media), not the vault stub.
  return <PreviewFrame channel={preview.channel}>{card}</PreviewFrame>
}

function VersionedChannelPreviewCard({
  preview,
  onMediaReadinessChange,
  onMediaStatusChange,
  onEditCaption,
  onEditImage,
  retryRequest,
}: Readonly<{
  preview: ApprovalPreviewSnapshot
  onMediaReadinessChange: (ready: boolean) => void
  onMediaStatusChange?: (status: MediaReadinessStatus) => void
  onEditCaption?: () => void
  onEditImage?: () => void
  retryRequest: number
}>) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  const [failedAtRequest, setFailedAtRequest] = useState<Readonly<Record<string, number>>>({})
  const [retryById, setRetryById] = useState<Readonly<Record<string, number>>>({})
  const imageElements = useRef<Record<string, HTMLImageElement | null>>({})
  const mediaPreloadsElement = useRef<HTMLDivElement | null>(null)
  const media = preview.media
  const failed = useMemo(() => new Set(media
    .filter((item) => failedAtRequest[item.id] === retryRequest)
    .map((item) => item.id)), [failedAtRequest, media, retryRequest])
  const active = media[activeIndex] ?? null
  const ready = failed.size === 0

  useEffect(() => {
    onMediaReadinessChange(ready)
    onMediaStatusChange?.({
      total: media.length,
      loaded: loaded.size,
      failedPositions: media.filter((item) => failed.has(item.id)).map((item) => item.position),
      ready,
    })
  }, [failed, loaded.size, media, onMediaReadinessChange, onMediaStatusChange, ready])

  useEffect(() => {
    if (media.length === 0 || loaded.size === media.length) return
    const probeDecodedImages = () => {
      const decoded = media
        .filter((item) => {
          const preloaded = mediaPreloadsElement.current?.querySelector<HTMLImageElement>(`[data-media-id="${item.id}"]`)
          return (imageElements.current[item.id]?.naturalWidth ?? preloaded?.naturalWidth ?? 0) > 0
        })
        .map((item) => item.id)
      if (decoded.length === 0) return
      setLoaded((current) => {
        const next = new Set(current)
        for (const id of decoded) next.add(id)
        return next.size === current.size ? current : next
      })
    }
    probeDecodedImages()
    const timer = window.setInterval(probeDecodedImages, 250)
    return () => window.clearInterval(timer)
  }, [loaded.size, media])

  useEffect(() => {
    let cancelled = false
    const recordLoaded = (id: string) => {
      setFailedAtRequest((current) => {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      })
      setLoaded((current) => new Set(current).add(id))
    }
    const recordFailed = (id: string) => {
      setLoaded((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setFailedAtRequest((current) => ({ ...current, [id]: retryRequest }))
    }
    const elements = mediaPreloadsElement.current?.querySelectorAll<HTMLImageElement>('[data-media-id]') ?? []
    for (const element of elements) {
      const id = element.dataset.mediaId
      if (!id) continue
      if (element.naturalWidth > 0) {
        recordLoaded(id)
        continue
      }
      if (typeof element.decode === 'function') {
        void element.decode()
          .then(() => { if (!cancelled) recordLoaded(id) })
          .catch(() => { if (!cancelled) recordFailed(id) })
      }
    }
    return () => { cancelled = true }
  }, [media, retryRequest])

  const activeSrc = useMemo(() => {
    if (!active) return null
    const retry = (retryById[active.id] ?? 0) + retryRequest
    if (retry === 0) return active.src
    return `${active.src}${active.src.includes('?') ? '&' : '?'}previewRetry=${retry}`
  }, [active, retryById, retryRequest])

  function markLoaded(id: string) {
    setFailedAtRequest((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
    setLoaded((current) => new Set(current).add(id))
  }

  function markFailed(id: string) {
    setLoaded((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    setFailedAtRequest((current) => ({ ...current, [id]: retryRequest }))
  }

  function retry(id: string) {
    setFailedAtRequest((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
    setRetryById((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }))
  }

  function renderMedia(className: string) {
    if (!active || !activeSrc) return null
    if (failed.has(active.id)) {
      return <div className={styles.mediaFailure} role="status">
        <strong>이미지를 불러오지 못했어요</strong>
        <span>{active.position}번 이미지가 실제 게시 화면에 보이는지 아직 확인할 수 없어요.</span>
        <button type="button" onClick={() => retry(active.id)} aria-label={`${active.position}번 이미지 다시 불러오기`}>
          다시 불러오기
        </button>
      </div>
    }
    return <Image
      key={`${active.id}:${(retryById[active.id] ?? 0) + retryRequest}`}
      className={className}
      src={activeSrc}
      alt={active.altText}
      width={1080}
      height={1080}
      sizes="(max-width: 820px) 100vw, 560px"
      unoptimized
      ref={(element) => { imageElements.current[active.id] = element }}
      onLoad={() => markLoaded(active.id)}
      onError={() => markFailed(active.id)}
    />
  }

  function renderNaverMedia(item: ApprovalPreviewSnapshot['media'][number]) {
    const retryNumber = (retryById[item.id] ?? 0) + retryRequest
    const src = retryNumber === 0
      ? item.src
      : `${item.src}${item.src.includes('?') ? '&' : '?'}previewRetry=${retryNumber}`
    if (failed.has(item.id)) {
      return <div className={styles.mediaFailure} role="status">
        <strong>이미지를 불러오지 못했어요</strong>
        <span>{item.position}번 이미지가 실제 게시 화면에 보이는지 아직 확인할 수 없어요.</span>
        <button type="button" onClick={() => retry(item.id)} aria-label={`${item.position}번 이미지 다시 불러오기`}>
          다시 불러오기
        </button>
      </div>
    }
    return <Image
      key={`${item.id}:${retryNumber}`}
      className={styles.threadsImage}
      src={src}
      alt={item.altText}
      width={1080}
      height={1080}
      sizes="(max-width: 820px) 100vw, 260px"
      unoptimized
      loading="eager"
      ref={(element) => { imageElements.current[item.id] = element }}
      onLoad={() => markLoaded(item.id)}
      onError={() => markFailed(item.id)}
    />
  }

  function show(index: number) {
    setActiveIndex(Math.max(0, Math.min(index, media.length - 1)))
  }

  if (preview.channel === 'threads') {
    return <article className={styles.threadsCard} aria-label={`Threads v${preview.versionNumber} 게시 미리보기`}>
      <header className={styles.accountHeader}>
        <span className={styles.avatar} aria-hidden="true">S</span>
        <div><strong>{preview.account.label}</strong><span>Threads · 공개 · v{preview.versionNumber}</span></div>
      </header>
      <div className={styles.editableCopy}>
        <p className={styles.threadsText}>{preview.text}</p>
        {onEditCaption ? <button aria-label="게시 문구 수정" className={styles.inlineEdit} onClick={onEditCaption} type="button"><PencilLine aria-hidden="true" /></button> : null}
      </div>
      {active ? <div className={styles.threadsMedia}>{renderMedia(styles.threadsImage)}
        {onEditImage ? <button aria-label="게시 이미지 수정" className={styles.inlineEdit} onClick={onEditImage} type="button"><PencilLine aria-hidden="true" /></button> : null}
      </div> : null}
      <p className={styles.identityNote}>이 문구와 미디어가 승인된 버전에서 그대로 전송됩니다.</p>
    </article>
  }

  if (preview.channel === 'naver_blog') {
    const visibilityLabel = preview.visibility === 'public' ? '공개'
      : preview.visibility ? NAVER_VISIBILITY_LABELS[preview.visibility] : '비공개'
    const mediaById = new Map(media.map((item) => [item.id, item]))
    return <article className={styles.threadsCard} aria-label={`네이버 블로그 v${preview.versionNumber} ${visibilityLabel} 게시 미리보기`}>
      <header className={styles.accountHeader}>
        <span className={styles.avatar} aria-hidden="true">N</span>
        <div><strong>{preview.account.label}</strong><span>네이버 블로그 · {visibilityLabel} · v{preview.versionNumber}</span></div>
      </header>
      <div className={styles.editableCopy}>
      {preview.naverBlocks ? <div className={styles.naverArticleFlow}>
        {preview.naverBlocks.map((block, index) => {
          const key = `${block.kind}-${index}`
          if (block.kind === 'image') {
            const item = mediaById.get(block.mediaId)
            return item ? <figure className={styles.naverMediaItem} data-naver-block="image" key={key}>
              {renderNaverMedia(item)}
              <figcaption>{block.altText}</figcaption>
            </figure> : null
          }
          if (block.kind === 'heading') return <h3 data-naver-block="heading" key={key}>{block.text}</h3>
          if (block.kind === 'paragraph') return <p data-naver-block="paragraph" key={key}>{block.text}</p>
          if (block.kind === 'quote') return <blockquote data-naver-block="quote" key={key}>{block.text}</blockquote>
          if (block.kind === 'link') return <a data-naver-block="link" href={block.url} key={key} rel="noreferrer" target="_blank">{block.title}</a>
          if (block.kind === 'map') return (
            <div data-naver-block="map" key={key} className="my-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm font-semibold text-foreground">
              <span className="flex size-6 items-center justify-center rounded-md bg-[#03C75A] text-white font-extrabold text-xs">P</span>
              <MapPin className="size-4 text-primary" aria-hidden="true" />
              <span>네이버 지도: {block.placeName}</span>
            </div>
          )
          return <p data-naver-block="cta" key={key}>{block.text}</p>
        })}
      </div> : <><p className={styles.threadsText}>{preview.text}</p>
      {media.length > 0 ? <div className={styles.naverMediaGrid}>
        {media.map((item) => (
          <figure className={styles.naverMediaItem} key={item.id}>
            {renderNaverMedia(item)}
            <figcaption>{item.position}번 이미지</figcaption>
          </figure>
        ))}
      </div> : null}</>}
      {onEditCaption ? <button aria-label="게시 문구 수정" className={styles.inlineEdit} onClick={onEditCaption} type="button"><PencilLine aria-hidden="true" /></button> : null}
      </div>
      <p className={styles.identityNote}>이 제목·본문·이미지·{visibilityLabel} 범위가 승인된 버전에서 그대로 전송됩니다.</p>
    </article>
  }

  return <section className={styles.instagramCard} role="region" aria-label={`Instagram v${preview.versionNumber} 게시 미리보기`}>
    <div aria-hidden="true" className={styles.mediaPreloads} ref={mediaPreloadsElement}>
      {media.map((item) => {
        const retryNumber = (retryById[item.id] ?? 0) + retryRequest
        const src = retryNumber === 0
          ? item.src
          : `${item.src}${item.src.includes('?') ? '&' : '?'}previewRetry=${retryNumber}`
        return <Image
          alt=""
          data-media-id={item.id}
          data-media-preload="true"
          height={1}
          key={`preload:${item.id}:${retryNumber}`}
          loading="eager"
          onError={() => markFailed(item.id)}
          onLoad={() => markLoaded(item.id)}
          ref={(element) => { imageElements.current[item.id] = element }}
          src={src}
          unoptimized
          width={1}
        />
      })}
    </div>
    <header className={styles.accountHeader}>
      <span className={styles.avatar} aria-hidden="true">S</span>
      <div><strong>{preview.account.label}</strong><span>Instagram · 공개 · v{preview.versionNumber}</span></div>
    </header>
    <div className={styles.instagramMedia}>
      {renderMedia(styles.instagramImage)}
      {onEditImage ? <button aria-label="게시 이미지 수정" className={styles.inlineEdit} onClick={onEditImage} type="button"><PencilLine aria-hidden="true" /></button> : null}
      {media.length > 1 ? <>
        <button
          className={styles.previousButton}
          type="button"
          onClick={() => show(activeIndex - 1)}
          disabled={activeIndex === 0}
          aria-label={`이전 이미지, ${Math.max(1, activeIndex)} / ${media.length}`}
        >‹</button>
        <button
          className={styles.nextButton}
          type="button"
          onClick={() => show(activeIndex + 1)}
          disabled={activeIndex === media.length - 1 || !active || !loaded.has(active.id)}
          aria-label={`다음 이미지, ${Math.min(media.length, activeIndex + 2)} / ${media.length}`}
        >›</button>
        <span className={styles.pageCount} aria-live="polite">{activeIndex + 1} / {media.length}</span>
      </> : null}
    </div>
    <div className={styles.instagramCopy}>
      <span className={styles.actionGlyphs} aria-label="Instagram 반응 동작">♡　◯　⌁</span>
      <p>{preview.text}</p>
      {onEditCaption ? <button aria-label="게시 문구 수정" className={styles.inlineEdit} onClick={onEditCaption} type="button"><PencilLine aria-hidden="true" /></button> : null}
    </div>
    <p className={styles.identityNote}>이미지 순서와 문구가 승인된 버전에서 그대로 전송됩니다.</p>
  </section>
}
