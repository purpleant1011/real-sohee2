import { MoreHorizontal, Play, Ticket } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { currentSpec } from '@/features/vault/channel-spec'
import { cn } from '@/lib/utils'
import type { DaangnMediaItem, DaangnNewsVariant } from './types'

// ANI-1542 실측 전: 당근 비즈프로필 실제 앱 화면 렌더링 구조는 아직 공식 실측되지 않았으므로
// 로고·상표 자산 없이 중립적인 모바일 카드 구조로 표현합니다. (자동 게시 기능 없음)

export interface DaangnNewsPreviewProps {
  readonly variant: DaangnNewsVariant
  readonly className?: string
}

function NeutralAvatar({ name }: { readonly name: string }) {
  const initial = name.trim().slice(0, 1) || '비'
  return (
    <div
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
    >
      {initial}
    </div>
  )
}

function UnverifiedBadge({ label = '확인이 필요해요' }: { readonly label?: string }) {
  return (
    <Badge
      variant="outline"
      className="inline-flex items-center gap-1 border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
      <span>{label}</span>
    </Badge>
  )
}

export function DaangnNewsPreview({ variant, className }: DaangnNewsPreviewProps) {
  const businessName = variant.businessName?.trim() || '비즈프로필'
  const timeLabel = variant.timeLabel?.trim() || '방금 전'

  // channel-spec 기준 수치 읽기 (ANI-1527 동기화)
  const maxImages = currentSpec.daangn.maxImages // 20
  const galleryDisplayImages = currentSpec.daangn.galleryDisplayImages // 10
  const maxVideos = currentSpec.daangn.maxVideos // 1

  // 미디어 분류
  const rawMedia = (variant.media ?? []) as readonly (DaangnMediaItem)[]
  const imageItems = rawMedia.filter((m) => m.type === 'image' || !m.type)
  const videoItems = rawMedia.filter((m) => m.type === 'video')
  const totalImageCount = imageItems.length
  const totalVideoCount = variant.videoCount ?? videoItems.length

  // 첫 줄 강조 및 본문 문단 추출
  const rawHighlight = variant.firstLineHighlight?.trim()
  const rawText = variant.text || ''

  let highlight = rawHighlight
  let bodyParagraphs: string[] = []

  if (highlight) {
    let remainder = rawText
    if (remainder.startsWith(highlight)) {
      remainder = remainder.slice(highlight.length).replace(/^[\r\n]+/, '')
    }
    bodyParagraphs = remainder
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } else {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 0) {
      highlight = lines[0]
      bodyParagraphs = lines.slice(1)
    }
  }

  const tagText = (variant.hashtags ?? []).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')

  // 쿠폰 영역 여부 판단
  const couponText = variant.coupon?.trim()
  const hasCoupon = Boolean(couponText && couponText !== '혜택 없음')

  // 갤러리 노출할 이미지 목록 (최대 galleryDisplayImages개)
  const visibleImages = imageItems.slice(0, galleryDisplayImages)
  const overflowImageCount = Math.max(0, totalImageCount - galleryDisplayImages)

  return (
    <article
      role="article"
      aria-label="당근 비즈프로필 소식 미리보기"
      className={cn(
        'w-full min-w-0 max-w-[420px] mx-auto overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs break-words [overflow-wrap:anywhere]',
        className
      )}
    >
      {/* 헤더: 중립 상호명, 시간, 소식 라벨 */}
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <NeutralAvatar name={businessName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{businessName}</p>
          <p className="text-xs text-muted-foreground">소식 · {timeLabel}</p>
        </div>
        <MoreHorizontal className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </header>

      {/* 본문 콘텐츠 영역 */}
      <div className="space-y-3.5 p-4">
        {/* 첫 줄 강조 문구 */}
        {highlight ? (
          <h3
            aria-label="강조 문구"
            className="text-base font-bold leading-snug text-foreground break-words [overflow-wrap:anywhere]"
          >
            {highlight}
          </h3>
        ) : null}

        {/* 짧은 본문 문단들 */}
        {bodyParagraphs.length > 0 ? (
          <div className="space-y-2 text-sm leading-relaxed text-foreground/90 break-words [overflow-wrap:anywhere]">
            {bodyParagraphs.map((para, idx) => (
              <p key={idx}>{para}</p>
            ))}
          </div>
        ) : null}

        {/* 승인한 태그: 복사 번들과 같은 값 */}
        {tagText ? (
          <p className="text-sm leading-relaxed text-foreground/90 break-words [overflow-wrap:anywhere]">{tagText}</p>
        ) : null}

        {/* 사진 갤러리 영역 */}
        {totalImageCount > 0 ? (
          <section aria-label="사진 갤러리" className="space-y-2">
            {totalImageCount === 1 ? (
              // 사진 1장 단일 레이아웃
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
                {imageItems[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageItems[0].url}
                    alt={imageItems[0].alt || '소식 사진 1'}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                    소식 사진 1
                  </div>
                )}
              </div>
            ) : (
              // 사진 2장 이상 갤러리 그리드
              <div
                className={cn(
                  'grid gap-1.5 overflow-hidden rounded-lg',
                  visibleImages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                )}
              >
                {visibleImages.map((img, idx) => {
                  const isLastVisible = idx === visibleImages.length - 1
                  const showOverflowOverlay = isLastVisible && overflowImageCount > 0

                  return (
                    <div
                      key={img.id || idx}
                      className="relative aspect-square overflow-hidden bg-muted"
                    >
                      {img.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.url}
                          alt={img.alt || `소식 사진 ${idx + 1}`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                          소식 사진 {idx + 1}
                        </div>
                      )}
                      {showOverflowOverlay ? (
                        <div
                          aria-label={`추가 사진 ${overflowImageCount}장`}
                          className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white"
                        >
                          +{overflowImageCount}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 사진 갤러리 10장 노출 규칙 및 UNVERIFIED 정직 안내 */}
            {totalImageCount > galleryDisplayImages ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <span className="break-words">
                  {`피드 갤러리에는 앞 ${galleryDisplayImages}장까지 우선 노출돼요.`}
                </span>
                <UnverifiedBadge />
              </div>
            ) : null}

            {/* 사진 최대 20장 초과 극단 입력 경고 및 UNVERIFIED 정직 안내 */}
            {totalImageCount > maxImages ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="break-words">
                  {`사진은 최대 ${maxImages}장까지 등록할 수 있어요 (현재 ${totalImageCount}장).`}
                </span>
                <UnverifiedBadge />
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 동영상 슬롯 영역 */}
        {totalVideoCount > 0 ? (
          <section aria-label="첨부 동영상" className="space-y-2">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-zinc-900 flex flex-col items-center justify-center text-white">
              <div className="grid size-12 place-items-center rounded-full bg-white/20 backdrop-blur-xs transition hover:scale-105">
                <Play className="size-6 fill-white text-white translate-x-0.5" aria-hidden />
              </div>
              <p className="mt-2 text-xs font-medium text-white/90">
                {`동영상 ${Math.min(totalVideoCount, maxVideos)}개`}
              </p>
            </div>

            {totalVideoCount > maxVideos ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="break-words">
                  {`동영상은 최대 ${maxVideos}개까지 첨부할 수 있어요 (현재 ${totalVideoCount}개).`}
                </span>
                <UnverifiedBadge />
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 쿠폰(선택) 영역 */}
        {hasCoupon ? (
          <section
            aria-label="쿠폰 혜택"
            className="flex items-center justify-between gap-3 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3.5 text-foreground"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Ticket className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-primary">쿠폰 혜택</span>
                <p className="truncate text-sm font-bold text-foreground break-words [overflow-wrap:anywhere]">
                  {couponText}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90"
            >
              쿠폰 받기
            </button>
          </section>
        ) : null}
      </div>
    </article>
  )
}
