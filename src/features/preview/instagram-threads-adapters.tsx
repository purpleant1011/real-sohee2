'use client'

import { useId, useState } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, MoreHorizontal, Repeat2, Send } from 'lucide-react'
import { countCodepoints, countThreadsLength, currentSpec, SPEC_RULES_METADATA } from '@/features/vault/channel-spec'

export interface InstagramPreviewVariant {
  handle: string
  caption: string
  hashtags?: readonly string[]
  imageUrl?: string | null
  /** Ordered image URLs for the carousel; when absent the legacy imageUrl is used. */
  imageUrls?: readonly string[]
  timeLabel?: string
}

export interface ThreadsPreviewVariant {
  handle: string
  caption: string
  hashtags?: readonly string[]
  imageUrl?: string | null
  timeLabel?: string
}

function Hashtags({ tags }: { tags: readonly string[] }) {
  if (!tags.length) return null
  return <span className="block break-all text-[#00376b]">{tags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}</span>
}

function Avatar({ handle }: { handle: string }) {
  return <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-bold text-white">{Array.from(handle.replace(/^@/, ''))[0] || 'S'}</span>
}

export function InstagramAdapterPreview({ handle, caption, hashtags = [], imageUrl, imageUrls, timeLabel = '방금 전' }: InstagramPreviewVariant) {
  const images = imageUrls ?? (imageUrl ? [imageUrl] : [])
  const [requestedIndex, setRequestedIndex] = useState(0)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const captionId = useId()
  const index = Math.min(requestedIndex, Math.max(0, images.length - 1))
  const activeUrl = images[index]
  const clean = handle.replace(/^@/, '')
  const fold = currentSpec.instagram.captionFoldThreshold
  const needsMore = countCodepoints(caption) > fold || caption.split('\n').length > 3
  const unverified = SPEC_RULES_METADATA['instagram-caption-fold']?.evidence === 'UNVERIFIED'

  return (
    <article aria-label="인스타그램 게시물 미리보기" className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-[14px] leading-[18px] text-zinc-900 shadow-sm sm:max-w-[420px]">
      <header className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <Avatar handle={handle} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{clean}</p>
          <p className="truncate text-[11px] text-zinc-700">스폰서 아님 · {timeLabel}</p>
        </div>
        <MoreHorizontal className="size-5 shrink-0" aria-hidden="true" />
      </header>
      <div data-testid="instagram-media" className="relative aspect-[4/5] w-full overflow-hidden bg-zinc-100">
        {activeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={activeUrl} src={activeUrl} alt={`게시물 이미지 ${index + 1} / ${images.length}`} onLoad={() => setLoadedUrl(activeUrl)} className="size-full object-cover" />
        ) : <div className="grid size-full place-items-center text-sm text-zinc-700">이미지 준비 중</div>}
        {images.length > 1 && <>
          <button type="button" aria-label="이전 이미지" disabled={index === 0} onClick={() => setRequestedIndex(index - 1)} className="absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-900 shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-40"><ChevronLeft aria-hidden="true" className="size-5" /></button>
          <button type="button" aria-label="다음 이미지" disabled={index === images.length - 1} onClick={() => setRequestedIndex(index + 1)} className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-900 shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-40"><ChevronRight aria-hidden="true" className="size-5" /></button>
          <span className="absolute right-2 top-2 rounded-full bg-zinc-900 px-2 py-1 text-xs text-white">{index + 1} / {images.length}</span>
        </>}
      </div>
      {images.length > 1 && <div role="group" aria-label="이미지 선택" className="flex justify-center gap-1 px-2 py-2">
        {images.map((url, dotIndex) => <button key={`${url}-${dotIndex}`} type="button" aria-label={`${dotIndex + 1}번 이미지 보기`} aria-current={dotIndex === index ? 'true' : undefined} onClick={() => setRequestedIndex(dotIndex)} className="grid size-9 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-zinc-900"><span aria-label={`${dotIndex + 1} / ${images.length}`} className={`size-2 rounded-full ${dotIndex === index ? 'bg-[#00376b]' : 'bg-zinc-500'}`} /></button>)}
      </div>}
      <div className="flex items-center gap-4 px-3 pt-3" aria-hidden="true"><Heart className="size-6" /><MessageCircle className="size-6" /><Send className="size-6" /><Bookmark className="ml-auto size-6" /></div>
      <div className="min-w-0 space-y-1 px-3 pb-3 pt-2">
        <p className="font-semibold">좋아요 0개</p>
        <div id={captionId} className={`min-w-0 whitespace-pre-wrap break-all ${!expanded && needsMore ? 'line-clamp-3' : ''}`}>
          <span className="mr-1.5 font-semibold">{clean}</span>{' '}
          {caption}
          {hashtags.length > 0 && (
            <>
              {'\n\n'}
              <Hashtags tags={hashtags} />
            </>
          )}
        </div>
        {needsMore && <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><button type="button" aria-controls={captionId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="rounded text-zinc-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-zinc-900">{expanded ? '접기' : '더 보기'}</button>{unverified && <span className="text-xs text-zinc-400">접힘 기준 미확인</span>}</div>}
        <p className="pt-1 text-[11px] text-zinc-700">{timeLabel}</p>
      </div>
      {loadedUrl && <span className="sr-only" role="status">이미지 표시 완료</span>}
    </article>
  )
}

export function ThreadsAdapterPreview({ handle, caption, hashtags = [], imageUrl, timeLabel = '방금' }: ThreadsPreviewVariant) {
  const clean = handle.replace(/^@/, '')
  const tagsText = hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')
  const length = countThreadsLength(caption + (tagsText ? `\n${tagsText}` : ''))
  const limit = currentSpec.threads.maxTextLength
  return (
    <article aria-label="스레드 게시물 미리보기" className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] leading-[21px] text-zinc-900 shadow-sm sm:max-w-[420px]">
      <div className="flex min-w-0 gap-3">
        <Avatar handle={handle} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate font-semibold">{clean}</span><span className="shrink-0 text-zinc-700">{timeLabel}</span><MoreHorizontal className="ml-auto size-5 shrink-0 text-zinc-700" aria-hidden="true" /></div>
          <p className="mt-0.5 whitespace-pre-wrap break-all">{caption}</p>
          <Hashtags tags={hashtags} />
          <p className={`mt-2 text-xs ${length > limit ? 'text-[#a41724]' : 'text-zinc-700'}`}>{length} / {limit}자{length > limit ? ' · 500자 초과했어요.' : ''}</p>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="게시물에 올라갈 이미지" className="mt-3 w-full max-w-full rounded-xl border border-zinc-200 object-cover" />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-5" aria-hidden="true"><Heart className="size-[22px]" /><MessageCircle className="size-[22px]" /><Repeat2 className="size-[22px]" /><Send className="size-[22px]" /></div>
        </div>
      </div>
    </article>
  )
}
