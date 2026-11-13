'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSyncedNaverCategoriesAction } from '@/features/naver-publish/get-synced-categories.action'
import type { NaverCategory } from '@/features/naver-publish/types'
import { NaverPostForm, type NaverPostFormValues } from './naver-post-form'
import { NaverGeneratingState } from './naver-generating-state'
import { NaverReviewStep } from './naver-review-step'
import type { PostFormatId } from '../post-modules'
import { cn } from '@/lib/utils'

export type NaverPanelStep = 'form' | 'generating' | 'review'

const STEPS: ReadonlyArray<{
  key: NaverPanelStep
  label: string
}> = [
  { key: 'form', label: '주제' },
  { key: 'generating', label: '만드는 중' },
  { key: 'review', label: '확인' },
]

export type CreatedNaverPostInfo = Readonly<{
  contentId: string
  versionId: string
  versionNumber: number
  title: string
  imageCount: number
}>

export function NaverPostPanel({
  workspaceId,
  open = true,
  onClose,
  categories: initialCategories,
  isNaverConnected = true,
  initialStep = 'form',
  initialPost = null,
  initialTopic = null,
  initialPostMode,
  placePhotosAvailable = false,
  businessProfile: initialBusinessProfile = null,
}: Readonly<{
  workspaceId: string
  open?: boolean
  onClose?: () => void
  categories?: readonly NaverCategory[]
  isNaverConnected?: boolean
  initialStep?: NaverPanelStep
  initialPost?: CreatedNaverPostInfo | null
  initialTopic?: string | null
  initialPostMode?: PostFormatId
  placePhotosAvailable?: boolean
  businessProfile?: { businessName?: string | null; industry?: string | null } | null
}>) {
  const [step, setStep] = useState<NaverPanelStep>(initialStep)
  const [businessProfile] = useState<{ businessName?: string | null; industry?: string | null } | null>(initialBusinessProfile ?? null)
  const [categories, setCategories] = useState<readonly NaverCategory[]>(initialCategories ?? [])
  const [formValues, setFormValues] = useState<NaverPostFormValues | null>(null)
  const [createdPost, setCreatedPost] = useState<CreatedNaverPostInfo | null>(initialPost)
  const [generateError, setGenerateError] = useState<{ message: string; errorCode?: string | null } | null>(null)

  const requestKeyRef = useRef<string>(crypto.randomUUID())
  const abortControllerRef = useRef<AbortController | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // Focus step heading on each transition per spec accessibility requirement
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  // Load categories if not provided initially
  useEffect(() => {
    if (!initialCategories || initialCategories.length === 0) {
      let active = true
      void getSyncedNaverCategoriesAction({ workspaceId }).then((res) => {
        if (active && res.data) {
          setCategories(res.data)
        }
      })
      return () => {
        active = false
      }
    }
  }, [workspaceId, initialCategories])

  const runGeneration = useCallback(
    async (values: NaverPostFormValues) => {
      setGenerateError(null)
      setStep('generating')

      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/naver-posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            topic: values.topic,
            imageCount: values.imageCount,
            photoSource: values.photoSource,
            visibility: values.visibility,
            categoryId: values.categoryId,
            requestKey: requestKeyRef.current,
            ...(values.postMode ? { postMode: values.postMode } : {}),
            ...(values.reaction ? { reaction: values.reaction } : {}),
            ...(values.imageStyle ? { imageStyle: values.imageStyle } : {}),
          }),
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          setGenerateError({
            message: data.error || '글을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            errorCode: data.errorCode || 'SERVICE_UNAVAILABLE',
          })
          return
        }

        setCreatedPost(data.post)
        setStep('review')
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setStep('form')
          return
        }
        setGenerateError({
          message: '네트워크 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          errorCode: 'SERVICE_UNAVAILABLE',
        })
      } finally {
        abortControllerRef.current = null
      }
    },
    [workspaceId],
  )

  function handleFormSubmit(values: NaverPostFormValues) {
    setFormValues(values)
    void runGeneration(values)
  }

  function handleRetry() {
    if (
      generateError?.errorCode === 'CLAIMS_NEED_REVIEW' ||
      generateError?.errorCode === 'DRAFT_FAILED'
    ) {
      requestKeyRef.current = crypto.randomUUID()
    }
    if (formValues) {
      void runGeneration(formValues)
    }
  }

  function handleCancelGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setStep('form')
    setGenerateError(null)
  }

  function handleReset() {
    requestKeyRef.current = crypto.randomUUID()
    setFormValues(null)
    setCreatedPost(null)
    setGenerateError(null)
    setStep('form')
  }

  if (!open) return null

  const stepTitles: Record<NaverPanelStep, string> = {
    form: '주제 입력',
    generating: '글 만드는 중',
    review: '글 확인 및 승인',
  }

  const selectedCategory = categories.find((c) => c.id === formValues?.categoryId)
  const categoryName = selectedCategory ? selectedCategory.name : null

  return (
    <div className="flex flex-col h-full max-w-full overflow-y-auto bg-background p-4 sm:p-6 space-y-6">
      {/* Top Header & Close button */}
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="space-y-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-bold text-foreground outline-none"
          >
            {stepTitles[step]}
          </h2>
          <p className="text-xs text-muted-foreground">
            소희가 네이버 블로그에 최적화된 글과 사진을 작성해 드려요.
          </p>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="패널 닫기"
            className="rounded-full size-8"
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {/* 3-Step Progress Track */}
      <nav aria-label="진행 단계">
        <ol className="flex items-center justify-between gap-1 sm:gap-2">
          {STEPS.map((s, idx) => {
            const isCurrent = step === s.key
            const stepOrder = ['form', 'generating', 'review']
            const isCompleted = stepOrder.indexOf(step) > idx

            return (
              <li
                key={s.key}
                aria-label={s.label}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium transition-colors',
                  isCurrent && 'text-primary font-bold',
                  isCompleted && 'text-muted-foreground',
                  !isCurrent && !isCompleted && 'text-muted-foreground/50',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center size-6 rounded-full text-xs border',
                    isCurrent && 'border-primary bg-primary text-primary-foreground',
                    isCompleted && 'border-muted-foreground/30 bg-muted text-muted-foreground',
                    !isCurrent && !isCompleted && 'border-muted text-muted-foreground/50',
                  )}
                  aria-hidden
                >
                  {isCompleted ? <Check className="size-3" /> : idx + 1}
                </span>
                <span className="hidden xs:inline sm:inline">{s.label}</span>
                {idx < STEPS.length - 1 && (
                  <ChevronRight className="size-3 text-muted-foreground/40 ml-1 shrink-0" aria-hidden />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="pt-2">
        {step === 'form' && (
          <NaverPostForm
            categories={categories}
            onSubmit={handleFormSubmit}
            onClose={onClose}
            isNaverConnected={isNaverConnected}
            initialTopic={initialTopic ?? ''}
            initialPostMode={initialPostMode}
            placePhotosAvailable={placePhotosAvailable}
            businessProfile={businessProfile}
          />
        )}

        {step === 'generating' && (
          <NaverGeneratingState
            topic={formValues?.topic ?? ''}
            imageCount={formValues?.imageCount ?? 4}
            onCancel={handleCancelGeneration}
            error={generateError}
            onRetry={handleRetry}
          />
        )}

        {step === 'review' && createdPost && (
          <NaverReviewStep
            workspaceId={workspaceId}
            contentId={createdPost.contentId}
            settings={{
              visibility: formValues?.visibility ?? 'public',
              categoryName,
              imageCount: formValues?.imageCount ?? 4,
            }}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  )
}
