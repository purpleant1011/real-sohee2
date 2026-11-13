import Image from 'next/image'
import type { ChannelVariantPayload, MediaItem, SpecEvaluationResult } from '@/features/vault/channel-spec'
import type { NaverBlogBlock } from '@/features/vault/transform/types'
import { NAVER_VISIBILITY_LABELS, type NaverVisibility } from '@/features/naver-publish/types'

export type NaverBlogVariant = Omit<ChannelVariantPayload, 'media'> & Readonly<{
  blocks?: readonly (NaverBlogBlock | Readonly<{ type: 'image'; mediaId?: string; src?: string; altText?: string }>)[]
  category?: string
  visibility?: NaverVisibility
  media?: (MediaItem & Readonly<{ src?: string; altText?: string }>)[]
}>

const wrap = 'min-w-0 max-w-full wrap-anywhere whitespace-pre-wrap'

/** Read-only article projection. Vault metadata does not include image URLs or visibility. */
export function NaverBlogPreview({ variant, specResult }: Readonly<{
  variant: NaverBlogVariant
  specResult?: SpecEvaluationResult
}>) {
  const images = variant.media?.filter((item) => item.type === 'image' && item.src) ?? []
  const hasImageBlocks = variant.blocks?.some((block) => block.type === 'image') ?? false
  const category = variant.category?.trim()
  const visibility = variant.visibility ? NAVER_VISIBILITY_LABELS[variant.visibility] : '확인이 필요해요'

  return <article aria-label="네이버 블로그 글 미리보기" className="min-w-0 max-w-full overflow-hidden bg-card px-4 py-6 text-card-foreground sm:px-6">
    <header className="min-w-0 space-y-3 border-b pb-5">
      <p className="text-sm text-foreground">카테고리: <span className={wrap}>{category || '확인이 필요해요'}</span></p>
      <h2 className={`${wrap} text-xl font-bold leading-snug`}>{variant.title}</h2>
      <p className="text-sm text-foreground">공개 설정: <span>{visibility}</span></p>
    </header>
    <div aria-label="본문 블록" className="min-w-0 space-y-5 py-6">
      {variant.blocks?.length ? variant.blocks.map((block, index) => {
        if (block.type === 'image') {
          const image = images.find((item) => item.id && item.id === block.mediaId)
          const src = image?.src ?? block.src
          return <figure className="min-w-0 max-w-full" key={index}>
            {src ? <Image className="block h-auto max-w-full rounded-md" src={src} alt={image?.altText ?? block.altText ?? '본문 이미지'} width={720} height={540} unoptimized /> : <figcaption className={wrap}>이미지 주소를 확인할 수 없어요.</figcaption>}
          </figure>
        }
        if (block.type === 'heading') return <h3 className={`${wrap} text-lg font-semibold`} key={index}>{block.text}</h3>
        if (block.type === 'quote') return <blockquote className={`${wrap} border-l-2 border-border pl-3`} key={index}>{block.text}</blockquote>
        return <p className={`${wrap} leading-7`} key={index}>{block.text}</p>
      }) : variant.text ? <p className={`${wrap} leading-7`}>{variant.text}</p> : null}
      {!hasImageBlocks && images.map((image, index) => <figure className="min-w-0 max-w-full" key={image.id ?? index}>
        <Image className="block h-auto max-w-full rounded-md" src={image.src!} alt={image.altText ?? '본문 이미지'} width={720} height={540} unoptimized />
      </figure>)}
    </div>
    {variant.hashtags?.length ? <div aria-label="태그" className="flex min-w-0 flex-wrap gap-2 border-t py-4 text-sm">
      {variant.hashtags.map((tag, index) => <span className={wrap} key={index}>{tag.startsWith('#') ? tag : `#${tag}`}</span>)}
    </div> : null}
    {specResult ? <section aria-label="게시 규격 확인 안내" className="min-w-0 space-y-2 border-t py-4 text-sm">
      {specResult.checks.filter((check) => check.evidence === 'CONFIG' || check.evidence === 'UNVERIFIED').map((check) =>
        <p className={wrap} key={check.id}><span className="font-semibold">확인이 필요해요</span> · {check.userMessage}</p>)}
    </section> : null}
  </article>
}
