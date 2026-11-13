'use client'

import { useEffect, useState } from 'react'
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Repeat2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Pixel-faithful stand-ins for how a post looks on Instagram and Threads.
 * These intentionally stay white-on-black-text in dark mode: owners are judging the real platform look.
 */
export interface SocialPreviewProps {
  handle: string
  caption: string
  hashtags?: readonly string[]
  imageUrl?: string | null
  /** e.g. "방금 전" */
  timeLabel?: string
  className?: string
}

function initial(handle: string) {
  return handle.replace(/^@/, '').slice(0, 1).toUpperCase() || 'S'
}

function Avatar({ handle, size = 32 }: { handle: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 text-xs font-bold text-white"
    >
      {initial(handle)}
    </span>
  )
}

export const INSTAGRAM_LIMITS = { caption: 2200, hashtags: 30, visibleLines: 3 } as const
export const THREADS_LIMITS = { text: 500 } as const

function Hashtags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null
  return (
    <span className="text-[#00376b]">
      {tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
    </span>
  )
}

export function InstagramPostPreview({ handle, caption, hashtags = [], imageUrl, timeLabel = '방금 전', className }: SocialPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [imageUrl])
  const clean = handle.replace(/^@/, '')
  const needsMore = caption.split('\n').length > INSTAGRAM_LIMITS.visibleLines || caption.length > 110

  return (
    <article
      aria-label="인스타그램 게시물 미리보기"
      className={cn('w-full max-w-[420px] overflow-hidden rounded-xl border border-neutral-200 bg-white text-[14px] leading-[18px] text-neutral-900 shadow-sm', className)}
    >
      <header className="flex items-center gap-3 px-3 py-2.5">
        <Avatar handle={handle} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{clean}</p>
          <p className="text-[11px] text-neutral-500">스폰서 아님 · {timeLabel}</p>
        </div>
        <MoreHorizontal className="size-5 text-neutral-900" aria-hidden />
      </header>

      <div className={cn('relative aspect-square w-full bg-neutral-100', imageUrl && !loaded && 'animate-pulse')}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="게시물에 올라갈 이미지"
            onLoad={() => setLoaded(true)}
            className={cn('size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
          />
        ) : (
          <div className="grid size-full place-items-center text-sm text-neutral-400">이미지 준비 중</div>
        )}
      </div>

      <div className="flex items-center gap-4 px-3 pt-3">
        <Heart className="size-6" aria-hidden />
        <MessageCircle className="size-6 -scale-x-100" aria-hidden />
        <Send className="size-6" aria-hidden />
        <Bookmark className="ml-auto size-6" aria-hidden />
      </div>

      <div className="space-y-1 px-3 pb-3 pt-2">
        <p className="font-semibold">좋아요 0개</p>
        <div className={cn('whitespace-pre-wrap break-words', !expanded && 'line-clamp-3')}>
          <span className="mr-1.5 font-semibold">{clean}</span>
          {caption}
          {hashtags.length > 0 && (
            <>
              {'\n\n'}
              <Hashtags tags={hashtags} />
            </>
          )}
        </div>
        {!expanded && needsMore && (
          <button type="button" onClick={() => setExpanded(true)} className="text-neutral-500 hover:underline">
            더 보기
          </button>
        )}
        <p className="pt-1 text-[11px] uppercase tracking-wide text-neutral-500">{timeLabel}</p>
      </div>
    </article>
  )
}

export function ThreadsPostPreview({ handle, caption, imageUrl, timeLabel = '방금', className }: Omit<SocialPreviewProps, 'hashtags'>) {
  const clean = handle.replace(/^@/, '')
  return (
    <article
      aria-label="스레드 게시물 미리보기"
      className={cn('w-full max-w-[420px] rounded-xl border border-neutral-200 bg-white px-4 py-3 text-[15px] leading-[21px] text-neutral-900 shadow-sm', className)}
    >
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <Avatar handle={handle} size={36} />
          <span aria-hidden className="mt-2 w-0.5 flex-1 rounded bg-neutral-200" />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{clean}</span>
            <span className="text-neutral-500">{timeLabel}</span>
            <MoreHorizontal className="ml-auto size-5 text-neutral-500" aria-hidden />
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{caption}</p>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="게시물에 올라갈 이미지" className="mt-3 w-full rounded-xl border border-neutral-200 object-cover" />
          )}
          <div className="mt-3 flex items-center gap-5 text-neutral-900">
            <Heart className="size-[22px]" aria-hidden />
            <MessageCircle className="size-[22px] -scale-x-100" aria-hidden />
            <Repeat2 className="size-[22px]" aria-hidden />
            <Send className="size-[22px]" aria-hidden />
          </div>
        </div>
      </div>
    </article>
  )
}
