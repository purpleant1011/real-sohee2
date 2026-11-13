'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Camera, Info, Minus, Plus, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { NaverCategory, NaverVisibility } from '@/features/naver-publish/types'
import { cn } from '@/lib/utils'
import {
  POST_FORMAT_MODULES,
  POST_IMAGE_STYLE_MODULES,
  POST_REACTION_MODULES,
  clampImageCount,
  getPostFormat,
  getPostImageStyle,
  getPostReaction,
  type PostFormatId,
  type PostImageStyleId,
  type PostReactionId,
} from '../post-modules'

export type NaverPostFormValues = {
  topic: string
  imageCount: number
  photoSource: 'place' | 'ai'
  visibility: NaverVisibility
  categoryId: string | null
  publishMode?: 'immediate' | 'scheduled'
  scheduledAt?: string | null
  postMode?: PostFormatId
  reaction?: PostReactionId
  imageStyle?: PostImageStyleId
}

export const QUICK_IMAGE_COUNTS = [1, 3, 6, 10, 15, 20] as const

export function getImageCountOptions(formatId: PostFormatId): number[] {
  const format = getPostFormat(formatId)
  const min = format?.imageMin ?? 1
  const max = format?.imageMax ?? 20

  const counts: number[] = []
  for (let i = min; i <= max; i++) {
    counts.push(i)
  }
  return counts
}

export type RecommendedTopicItem = Readonly<{
  title: string
  desc: string
  badge: string
  safePrompt: string
}>

export function getRecommendedTopics(business?: { businessName?: string | null; industry?: string | null }): readonly RecommendedTopicItem[] {
  const name = business?.businessName?.trim() || '우리 매장'
  const industry = business?.industry?.trim() || '매장'

  return Object.freeze([
    {
      title: `${name}의 정성스러운 공간과 이야기`,
      desc: `고객을 위한 1:1 맞춤 정성과 공간 철학 소개`,
      badge: '추천',
      safePrompt: `${name}의 일상과 정성스러운 매장 공간 및 철학 이야기 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
    },
    {
      title: `${industry} 전문가가 전하는 일상 팁 노하우`,
      desc: `고객의 고민을 덜어주는 유용하고 실용적인 일상 관리 팁`,
      badge: '인기 주제',
      safePrompt: `${industry} 일상에서 유용한 관리 팁과 실용적인 노하우 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
    },
    {
      title: `처음 방문하시는 분들을 위한 ${name} 맞춤 안내`,
      desc: `방문 전 알아두면 좋은 순서와 편안한 1:1 상담 안내`,
      badge: '매장 소개',
      safePrompt: `처음 방문하시는 분들을 위한 ${name} 공간과 맞춤 방문 순서 안내 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
    },
  ])
}

export const RECOMMENDED_TOPICS = getRecommendedTopics()

export function NaverPostForm({
  categories: _categories = [],
  onSubmit,
  disabled = false,
  creditCost: _creditCost,
  initialImageCount,
  initialTopic = '',
  initialPhotoSource = 'ai',
  initialPostMode,
  placePhotosAvailable = false,
  businessProfile,
  onClose,
}: Readonly<{
  categories?: readonly NaverCategory[]
  onSubmit: (values: NaverPostFormValues) => void
  onClose?: () => void
  isNaverConnected?: boolean
  disabled?: boolean
  creditCost?: number
  initialVisibility?: NaverVisibility
  initialImageCount?: number
  initialTopic?: string
  initialPhotoSource?: 'place' | 'ai'
  initialPostMode?: PostFormatId
  placePhotosAvailable?: boolean
  businessProfile?: { businessName?: string | null; industry?: string | null } | null
}>) {
  void _categories
  void _creditCost
  const recommendedTopics = useMemo(
    () => getRecommendedTopics(businessProfile ?? undefined),
    [businessProfile],
  )
  const [topic, setTopic] = useState(initialTopic)
  const [prevInitialTopic, setPrevInitialTopic] = useState(initialTopic)
  if (initialTopic !== prevInitialTopic) {
    setPrevInitialTopic(initialTopic)
    if (!topic) {
      setTopic(initialTopic)
    }
  }

  const [postFormat, setPostFormat] = useState<PostFormatId>(initialPostMode ?? 'information')
  const [reaction, setReaction] = useState<PostReactionId>('inquiry')

  const initialEffectivePhotoSource = initialPhotoSource === 'place' && placePhotosAvailable ? 'place' : 'ai'
  const [photoSource, setPhotoSource] = useState<'place' | 'ai'>(initialEffectivePhotoSource)
  const [imageStyle, setImageStyle] = useState<PostImageStyleId>(
    initialEffectivePhotoSource === 'place' ? 'store_photo' : 'bright_space',
  )
  const [isCountUserSelected, setIsCountUserSelected] = useState<boolean>(
    initialImageCount !== undefined,
  )

  const [imageCount, setImageCount] = useState<number>(() => {
    const initialFormat = initialPostMode ?? 'information'
    const format = getPostFormat(initialFormat)
    if (initialImageCount !== undefined) {
      return clampImageCount(initialFormat, initialImageCount)
    }
    return format?.imageDefault ?? 4
  })

  const [error, setError] = useState<string | null>(null)

  const currentFormat = getPostFormat(postFormat)
  const currentReaction = getPostReaction(reaction)
  const currentImageStyle = getPostImageStyle(imageStyle)
  const currentMin = currentFormat?.imageMin ?? 1
  const currentMax = currentFormat?.imageMax ?? 20
  const quickCounts = QUICK_IMAGE_COUNTS.filter((c) => c >= currentMin && c <= currentMax)

  function handleCountChange(newCount: number) {
    const min = currentFormat?.imageMin ?? 1
    const max = currentFormat?.imageMax ?? 20
    const clamped = Math.max(min, Math.min(max, newCount))
    setIsCountUserSelected(true)
    setImageCount(clamped)
  }

  function handleFormatChange(newFormatId: PostFormatId) {
    setPostFormat(newFormatId)
    const newFormat = getPostFormat(newFormatId)
    const newMin = newFormat?.imageMin ?? 1
    const newMax = newFormat?.imageMax ?? 20
    const newDefault = newFormat?.imageDefault ?? 4

    if (isCountUserSelected) {
      if (imageCount < newMin || imageCount > newMax) {
        setImageCount(clampImageCount(newFormatId, imageCount))
      }
      // 범위 안이면 유지
    } else {
      setImageCount(newDefault)
    }
  }

  function handleImageStyleChange(newStyleId: PostImageStyleId) {
    if (newStyleId === 'store_photo' && !placePhotosAvailable) {
      return
    }
    setImageStyle(newStyleId)
    if (newStyleId === 'store_photo') {
      setPhotoSource('place')
    } else {
      setPhotoSource('ai')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = topic.trim()
    if (!trimmed) {
      setError('주제를 입력해 주세요.')
      return
    }
    setError(null)
    onSubmit({
      topic: trimmed,
      imageCount,
      photoSource,
      visibility: 'public',
      categoryId: null,
      ...(postFormat !== 'information' ? { postMode: postFormat } : {}),
      reaction,
      imageStyle,
    })
  }

  const summaryText = `${currentFormat?.label ?? '정보형'} · 사진 ${imageCount}장 · ${currentReaction?.label ?? '문의·상담 유도'}`

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 1. 어떤 형태의 글을 쓸까요? */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-foreground">
            어떤 형태의 글을 쓸까요?
          </label>
          <p className="text-xs text-muted-foreground">
            목적에 맞게 글의 뼈대와 사진 구성을 선택해요.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="글 형태 선택"
          className="grid grid-cols-2 gap-2"
        >
          {POST_FORMAT_MODULES.map((fmt) => {
            const isSelected = postFormat === fmt.id
            return (
              <button
                key={fmt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => handleFormatChange(fmt.id)}
                className={cn(
                  'flex flex-col text-left rounded-xl border p-2.5 sm:p-3 min-h-[44px] transition-all duration-150 cursor-pointer',
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary shadow-xs'
                    : 'bg-card hover:bg-accent/40 border-border text-foreground hover:border-primary/40',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-sm">{fmt.label}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                    추천 {fmt.imageDefault}장
                  </span>
                </div>
                <p className="hidden sm:block text-xs text-muted-foreground mt-1 line-clamp-2">
                  {fmt.summary}
                </p>
              </button>
            )
          })}
        </div>
        {currentFormat && (
          <p className="text-xs text-muted-foreground sm:hidden px-0.5">
            {currentFormat.summary}
          </p>
        )}
      </div>

      {/* 2. 어떤 주제로 쓸까요? */}
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="naver-topic-input" className="text-sm font-semibold text-foreground">
              어떤 주제로 쓸까요? <span className="text-destructive">*</span>
            </label>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {topic.length}/300
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            원하는 주제를 직접 적거나 아래 추천 글감을 골라보세요.
          </p>
        </div>

        {/* Recommended Topics Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Sparkles className="size-3.5 text-primary fill-primary/20" aria-hidden />
            <span>소희 추천 글감</span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {recommendedTopics.map((rec) => {
              const isSelected = topic === rec.safePrompt
              return (
                <button
                  key={rec.title}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setTopic(rec.safePrompt)
                    const clamped = clampImageCount(postFormat, 3)
                    handleCountChange(clamped)
                    if (error) setError(null)
                  }}
                  className={cn(
                    'flex flex-col text-left rounded-xl border p-3 min-h-[44px] transition-all duration-150',
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-xs ring-1 ring-primary'
                      : 'bg-card hover:bg-accent/40 border-border text-foreground hover:border-primary/40',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm line-clamp-1">{rec.title}</span>
                    <span
                      className={cn(
                        'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {rec.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rec.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Topic input */}
        <div className="space-y-1">
          <Textarea
            id="naver-topic-input"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value.slice(0, 300))
              if (error) setError(null)
            }}
            placeholder="예: 가을철 피부관리, 이렇게 하세요"
            rows={3}
            maxLength={300}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'naver-topic-error' : undefined}
            className="resize-none"
          />
          {error && (
            <p id="naver-topic-error" className="text-xs font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* 3. 어떤 이미지를 만들까요? */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-foreground">
            어떤 이미지를 만들까요?
          </label>
          <p className="text-xs text-muted-foreground">
            원하는 사진 연출 스타일과 장수를 선택해요.
          </p>
        </div>

        {/* Image Style Modules */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">이미지 스타일</span>
          <div
            role="radiogroup"
            aria-label="이미지 연출 스타일 선택"
            className="grid grid-cols-2 gap-2"
          >
            {POST_IMAGE_STYLE_MODULES.map((style) => {
              const isSelected = imageStyle === style.id
              const isStorePhoto = style.id === 'store_photo'
              const isStyleDisabled = disabled || (isStorePhoto && !placePhotosAvailable)
              return (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-disabled={isStyleDisabled}
                  disabled={isStyleDisabled}
                  onClick={() => handleImageStyleChange(style.id)}
                  className={cn(
                    'flex flex-col text-left rounded-xl border p-2.5 sm:p-3 min-h-[44px] transition-all duration-150',
                    isStyleDisabled
                      ? 'opacity-50 cursor-not-allowed bg-muted/30 border-border text-muted-foreground'
                      : isSelected
                        ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary shadow-xs cursor-pointer'
                        : 'bg-card hover:bg-accent/40 border-border text-foreground hover:border-primary/40 cursor-pointer',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm line-clamp-1">{style.label}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                      {style.source === 'place' ? '플레이스 사진' : 'AI 생성'}
                    </span>
                  </div>
                  {isStorePhoto && !placePhotosAvailable ? (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      연동된 매장 사진이 아직 없어요
                    </p>
                  ) : (
                    <p className="hidden sm:block text-xs text-muted-foreground mt-1 line-clamp-1">
                      {style.summary}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
          {currentImageStyle && (
            <p className="text-xs text-muted-foreground sm:hidden px-0.5">
              {currentImageStyle.summary}
            </p>
          )}
        </div>

        {/* Photo count section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">사진 장수</span>
            <span className="text-xs text-muted-foreground">
              {currentMin}장 ~ {currentMax}장 선택 가능
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Stepper */}
            <div
              role="group"
              aria-label="사진 장수 조절"
              className="flex items-center gap-2"
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="사진 장수 줄이기"
                disabled={disabled || imageCount <= currentMin}
                onClick={() => handleCountChange(imageCount - 1)}
                className="size-11 min-h-[44px] min-w-[44px] rounded-lg shrink-0"
              >
                <Minus className="size-4" aria-hidden />
              </Button>

              <div
                role="spinbutton"
                aria-label="사진 장수"
                aria-valuenow={imageCount}
                aria-valuemin={currentMin}
                aria-valuemax={currentMax}
                aria-valuetext={`${imageCount}장`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (disabled) return
                  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    handleCountChange(imageCount + 1)
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                    e.preventDefault()
                    handleCountChange(imageCount - 1)
                  } else if (e.key === 'Home') {
                    e.preventDefault()
                    handleCountChange(currentMin)
                  } else if (e.key === 'End') {
                    e.preventDefault()
                    handleCountChange(currentMax)
                  }
                }}
                className="flex items-baseline justify-center min-w-[5.5rem] px-4 py-2 rounded-lg bg-muted/40 border border-border text-center select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-2xl font-bold tracking-tight text-foreground">{imageCount}</span>
                <span className="text-sm font-medium text-muted-foreground ml-1">장</span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="사진 장수 늘리기"
                disabled={disabled || imageCount >= currentMax}
                onClick={() => handleCountChange(imageCount + 1)}
                className="size-11 min-h-[44px] min-w-[44px] rounded-lg shrink-0"
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>

            {/* Quick select chips */}
            {quickCounts.length > 0 && (
              <div
                role="group"
                aria-label="빠른 장수 선택"
                className="flex flex-wrap items-center gap-1.5"
              >
                {quickCounts.map((count) => {
                  const active = imageCount === count
                  return (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={active}
                      disabled={disabled}
                      onClick={() => handleCountChange(count)}
                      className={cn(
                        'min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
                        active
                          ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                          : 'bg-card hover:bg-accent/50 text-foreground border-border',
                      )}
                    >
                      {count}장
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="sr-only" aria-live="polite">
            현재 사진 장수: {imageCount}장
          </div>

          {/* 크레딧 인지 안내 (숫자 없이, Alert) */}
          {photoSource === 'place' ? (
            <Alert variant="default" className="bg-muted/50 border-border text-foreground">
              <Camera className="size-4 text-emerald-600 shrink-0" aria-hidden />
              <AlertDescription className="text-xs text-muted-foreground">
                매장 사진은 크레딧이 들지 않아요.
              </AlertDescription>
            </Alert>
          ) : imageCount >= 13 ? (
            <Alert variant="warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <AlertDescription className="text-xs font-medium">
                사진을 많이 만들수록 크레딧이 많이 사용돼요. 꼭 필요한 장수만 골라 주세요.
              </AlertDescription>
            </Alert>
          ) : imageCount >= 7 ? (
            <Alert variant="info">
              <Info className="size-4 shrink-0" aria-hidden />
              <AlertDescription className="text-xs font-medium">
                사진이 많을수록 크레딧이 더 많이 사용돼요.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>

      {/* 4. 글을 본 사람이 어떻게 반응하면 좋을까요? */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-foreground">
            글을 본 사람이 어떻게 반응하면 좋을까요?
          </label>
          <p className="text-xs text-muted-foreground">
            글의 맺음말과 콜투액션(CTA) 방향을 정해요.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="독자 반응 유도 선택"
          className="grid grid-cols-2 gap-2"
        >
          {POST_REACTION_MODULES.map((rec) => {
            const isSelected = reaction === rec.id
            return (
              <button
                key={rec.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => setReaction(rec.id)}
                className={cn(
                  'flex flex-col text-left rounded-xl border p-2.5 sm:p-3 min-h-[44px] transition-all duration-150 cursor-pointer',
                  isSelected
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary shadow-xs'
                    : 'bg-card hover:bg-accent/40 border-border text-foreground hover:border-primary/40',
                )}
              >
                <span className="font-semibold text-sm">{rec.label}</span>
                <p className="hidden sm:block text-xs text-muted-foreground mt-1 line-clamp-2">
                  {rec.summary}
                </p>
              </button>
            )
          })}
        </div>
        {currentReaction && (
          <p className="text-xs text-muted-foreground sm:hidden px-0.5">
            {currentReaction.summary}
          </p>
        )}
      </div>

      {/* Category Notice */}
      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        카테고리와 공개 범위는 네이버 글쓰기 화면에서 직접 선택해요.
      </div>

      {/* Sticky Action Footer */}
      <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 bg-background/95 backdrop-blur-sm sm:backdrop-blur-none sm:bg-transparent border-t border-border/60 sm:border-0 sm:static space-y-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
        {/* 선택 요약 한 줄 */}
        <div
          className="rounded-xl border border-border/70 bg-muted/40 p-2.5 sm:p-3 text-center text-xs text-muted-foreground font-medium"
          aria-live="polite"
        >
          {summaryText}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {onClose && (
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-[48px] px-5 font-semibold text-muted-foreground"
            >
              닫기
            </Button>
          )}
          <Button
            type="submit"
            disabled={disabled}
            className="flex-1 min-h-[48px] text-base font-semibold"
          >
            소희에게 글 쓰기 맡기기
          </Button>
        </div>
      </div>
    </form>
  )
}
