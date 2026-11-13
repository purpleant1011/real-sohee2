'use client'

import { Bookmark, Heart, MessageCircle, Repeat2, Send } from 'lucide-react'

export type PreviewMedia = Readonly<{ id: string; src: string; alt: string }>
export type PreviewEditorBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'cta'; text: string }
  | { kind: 'image'; mediaId: string; altText?: string }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'map'; placeName: string }

export type ChannelPreviewInput = Readonly<{
  channel: string
  accountName: string
  title: string
  caption: string
  hashtags: readonly string[]
  media: readonly PreviewMedia[]
  editorBlocks?: readonly PreviewEditorBlock[] | null
}>

export const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram', threads: 'Threads', naver_blog: '네이버 블로그', daangn_business: '당근 비즈프로필',
}
export const MANUAL_CHANNELS: ReadonlySet<string> = new Set(['naver_blog', 'daangn_business'])

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{name.slice(0, 1)}</span>
}

function Photo({ m, className }: { m: PreviewMedia; className: string }) {
  // 승인·게시와 같은 사진 경로만 쓴다. 장식이 아니라 실제 원고의 사진이다.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={m.src} alt={m.alt} loading="lazy" className={className} />
}

function Tags({ tags, className }: { tags: readonly string[]; className: string }) {
  return tags.length > 0 ? <p className={className}>{tags.join(' ')}</p> : null
}

/** 채널별 최종 게시 모양을 흉내 낸 읽기 전용 미리보기. 게시·저장·전송은 하지 않는다. */
export function ChannelStylePreview(p: ChannelPreviewInput) {
  const label = `${CHANNEL_LABEL[p.channel] ?? '채널'} 미리보기`
  const first = p.media[0]

  if (p.channel === 'naver_blog') {
    const hasEditorBlocks = Boolean(p.editorBlocks && p.editorBlocks.length > 0)
    const mediaMap = new Map(p.media.map(m => [m.id.toLowerCase(), m]))

    return (
      <article aria-label={label} className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="h-1 bg-[#03c75a]" aria-hidden="true" />
        <div className="space-y-3 p-4">
          <p className="text-xs font-medium text-muted-foreground">{p.accountName} · 블로그</p>
          <h3 className="text-lg font-bold leading-snug">{p.title}</h3>
          {hasEditorBlocks ? (
            p.editorBlocks!.map((block, index) => {
              const key = `${block.kind}-${index}`
              if (block.kind === 'paragraph') {
                return (
                  <p key={key} data-naver-block="paragraph" className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">
                    {block.text}
                  </p>
                )
              }
              if (block.kind === 'heading') {
                return (
                  <h4 key={key} data-naver-block="heading" className="pt-1 text-base font-bold leading-snug text-foreground">
                    {block.text}
                  </h4>
                )
              }
              if (block.kind === 'image') {
                const m = mediaMap.get(block.mediaId.toLowerCase())
                const photoMedia: PreviewMedia = {
                  id: block.mediaId,
                  src: m?.src ?? '',
                  alt: block.altText || m?.alt || '원고 사진',
                }
                return (
                  <div key={key} data-naver-block="image">
                    <Photo m={photoMedia} className="w-full rounded-lg" />
                  </div>
                )
              }
              if (block.kind === 'quote') {
                return (
                  <blockquote key={key} data-naver-block="quote" className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">
                    {block.text}
                  </blockquote>
                )
              }
              if (block.kind === 'cta') {
                return (
                  <p key={key} data-naver-block="cta" className="rounded-xl border border-border bg-muted/50 p-3 text-sm font-semibold text-foreground">
                    {block.text}
                  </p>
                )
              }
              if (block.kind === 'link') {
                return (
                  <a
                    key={key}
                    data-naver-block="link"
                    href={block.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-primary underline underline-offset-4"
                  >
                    {block.title}
                  </a>
                )
              }
              if (block.kind === 'map') {
                return (
                  <p key={key} data-naver-block="map" className="text-sm font-medium text-muted-foreground">
                    지도: {block.placeName}
                  </p>
                )
              }
              return null
            })
          ) : (
            <>
              {p.media.map(m => <Photo key={m.id} m={m} className="w-full rounded-lg" />)}
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">{p.caption}</p>
            </>
          )}
          <Tags tags={p.hashtags} className="text-sm text-muted-foreground" />
        </div>
      </article>
    )
  }

  if (p.channel === 'daangn_business') {
    return (
      <article aria-label={label} className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex items-center gap-2.5 p-3.5">
          <Avatar name={p.accountName} />
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{p.accountName}</p><p className="text-xs text-muted-foreground">비즈프로필 소식</p></div>
        </header>
        {first ? <Photo m={first} className="aspect-[4/3] w-full object-cover" /> : null}
        <div className="space-y-2 p-3.5">
          <p className="text-[15px] font-semibold">{p.title}</p>
          <p className="whitespace-pre-wrap text-sm leading-6">{p.caption}</p>
          <Tags tags={p.hashtags} className="text-sm text-[#ff6f0f]" />
        </div>
      </article>
    )
  }

  if (p.channel === 'threads') {
    return (
      <article aria-label={label} className="flex gap-3 rounded-2xl border border-border bg-card p-3.5">
        <Avatar name={p.accountName} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">{p.accountName}</p>
          <p className="whitespace-pre-wrap text-[15px] leading-6">{p.caption}</p>
          <Tags tags={p.hashtags} className="text-sm text-muted-foreground" />
          {first ? <Photo m={first} className="max-h-96 w-full rounded-xl object-cover" /> : null}
          <div className="flex gap-4 pt-1 text-muted-foreground" aria-hidden="true"><Heart className="size-5" /><MessageCircle className="size-5" /><Repeat2 className="size-5" /><Send className="size-5" /></div>
        </div>
      </article>
    )
  }

  if (p.channel === 'instagram') {
    return (
      <article aria-label={label} className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex items-center gap-2.5 p-3">
          <Avatar name={p.accountName} />
          <p className="truncate text-sm font-semibold">{p.accountName}</p>
        </header>
        {first ? <div className="relative"><Photo m={first} className="aspect-square w-full object-cover" />{p.media.length > 1 ? <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">1/{p.media.length}</span> : null}</div> : null}
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-4" aria-hidden="true"><Heart className="size-6" /><MessageCircle className="size-6" /><Send className="size-6" /><Bookmark className="ml-auto size-6" /></div>
          <p className="whitespace-pre-wrap text-sm leading-6"><strong className="mr-1">{p.accountName}</strong>{p.caption}</p>
          <Tags tags={p.hashtags} className="text-sm text-primary" />
        </div>
      </article>
    )
  }

  return (
    <article aria-label={label} className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">{p.title}</p>
      {first ? <Photo m={first} className="w-full rounded-lg" /> : null}
      <p className="whitespace-pre-wrap text-sm leading-6">{p.caption}</p>
      <Tags tags={p.hashtags} className="text-sm text-muted-foreground" />
    </article>
  )
}
