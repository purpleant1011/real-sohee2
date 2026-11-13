'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NaverStep } from '../naver-step-sequence'
import { NaverSinglePhotoSave } from './naver-photo-save-list'

export type NaverStepListProps = Readonly<{
  steps: readonly NaverStep[]
  postMode?: 'information' | 'faq' | 'comparison' | 'consultation' | string | null
  className?: string
}>

function StepBadge({ stepNumber }: { stepNumber: number }) {
  return (
    <span
      aria-label={`${stepNumber}단계`}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground leading-none tabular-nums"
    >
      <span aria-hidden="true">{stepNumber}</span>
    </span>
  )
}

function getCategoryRecommendation(mode?: string | null): string {
  switch (mode) {
    case 'faq':
      return '자주 묻는 질문'
    case 'comparison':
      return '비교'
    case 'consultation':
      return '상담 안내'
    case 'information':
    default:
      return '정보'
  }
}

export function NaverStepList({
  steps,
  postMode,
  className,
}: NaverStepListProps) {
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set())
  const [copyState, setCopyState] = useState<Readonly<Record<number, 'copied' | 'failed'>>>({})
  const [fallbackSheet, setFallbackSheet] = useState<{ stepIndex: number; text: string } | null>(null)
  const [expandedPreviews, setExpandedPreviews] = useState<ReadonlySet<number>>(new Set())

  const totalSteps = steps.length
  const completedCount = completedSteps.size

  function toggleStepCompletion(index: number) {
    setCompletedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  function togglePreviewExpansion(index: number) {
    setExpandedPreviews((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  async function handleCopy(stepIndex: number, text: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopyState((prev) => ({ ...prev, [stepIndex]: 'copied' }))
        setCompletedSteps((prev) => {
          const next = new Set(prev)
          next.add(stepIndex)
          return next
        })
        setTimeout(() => {
          setCopyState((prev) => {
            const next = { ...prev }
            delete next[stepIndex]
            return next
          })
        }, 2000)
      } else {
        setCopyState((prev) => ({ ...prev, [stepIndex]: 'failed' }))
        setFallbackSheet({ stepIndex, text })
      }
    } catch {
      setCopyState((prev) => ({ ...prev, [stepIndex]: 'failed' }))
      setFallbackSheet({ stepIndex, text })
    }
  }

  const hasPhoto = steps.some((step) => step.type === 'image')
  const thumbnailPhotoLabel = hasPhoto ? '사진 1' : '사진 없음'
  const recommendedCategory = getCategoryRecommendation(postMode)

  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      {/* 진행 상황 요약 헤더 */}
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <div className="space-y-0.5">
          <span className="text-xs font-semibold text-muted-foreground">직접 작성 진행률</span>
          <p className="text-sm font-bold text-foreground">
            {completedCount}/{totalSteps} 완료
          </p>
        </div>
        <div className="h-2 w-28 sm:w-36 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* 단계별 체크리스트 */}
      <ol className="space-y-3 list-none p-0 m-0">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.has(index)
          const isCopied = copyState[index] === 'copied'
          const stepNumber = index + 1

          if (step.type === 'title') {
            return (
              <li
                key={index}
                className={`rounded-xl border p-3.5 sm:p-4 transition-colors space-y-3 ${
                  isCompleted ? 'bg-muted/30 border-muted-foreground/20' : 'bg-card border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      id={`step-check-${index}`}
                      aria-label={`단계 ${index + 1} 완료`}
                      checked={isCompleted}
                      onChange={() => toggleStepCompletion(index)}
                      className="mt-1 size-5 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StepBadge stepNumber={stepNumber} />
                        <span className="font-bold text-sm text-foreground">제목 복사</span>
                        {isCompleted ? (
                          <span className="text-[11px] font-semibold text-primary">
                            완료됨
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-foreground font-medium break-words">
                        {step.text}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={isCopied ? 'secondary' : 'outline'}
                    size="sm"
                    aria-label="제목 복사"
                    onClick={() => void handleCopy(index, step.text)}
                    className="min-h-11 shrink-0 px-3 text-xs font-semibold"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 mr-1.5 text-primary" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 mr-1.5" />
                        <span>제목 복사</span>
                      </>
                    )}
                  </Button>
                </div>
              </li>
            )
          }

          if (step.type === 'text') {
            const isExpanded = expandedPreviews.has(index)
            const label = `본문 ${step.segmentIndex}/${step.segmentCount} 복사`
            return (
              <li
                key={index}
                className={`rounded-xl border p-3.5 sm:p-4 transition-colors space-y-3 ${
                  isCompleted ? 'bg-muted/30 border-muted-foreground/20' : 'bg-card border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      id={`step-check-${index}`}
                      aria-label={`단계 ${index + 1} 완료`}
                      checked={isCompleted}
                      onChange={() => toggleStepCompletion(index)}
                      className="mt-1 size-5 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StepBadge stepNumber={stepNumber} />
                        <span className="font-bold text-sm text-foreground">{label}</span>
                        {step.heading ? (
                          <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground truncate max-w-[200px]">
                            {step.heading}
                          </span>
                        ) : null}
                        {isCompleted ? (
                          <span className="text-[11px] font-semibold text-primary">
                            완료됨
                          </span>
                        ) : null}
                      </div>

                      {/* 접힌 미리보기 */}
                      {(() => {
                        const previewContent = step.previewText !== undefined
                          ? step.previewText
                          : step.heading && step.text.startsWith(step.heading)
                            ? step.text.slice(step.heading.length).replace(/^\n+/u, '')
                            : step.text

                        if (!previewContent) return null

                        return (
                          <div className="text-xs text-muted-foreground">
                            <p className={`whitespace-pre-wrap break-words ${isExpanded ? '' : 'line-clamp-2'}`}>
                              {previewContent}
                            </p>
                            <button
                              type="button"
                              onClick={() => togglePreviewExpansion(index)}
                              className="mt-1 flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline focus:outline-none"
                            >
                              {isExpanded ? (
                                <>
                                  <span>접기</span>
                                  <ChevronUp className="size-3" />
                                </>
                              ) : (
                                <>
                                  <span>전체 보기</span>
                                  <ChevronDown className="size-3" />
                                </>
                              )}
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant={isCopied ? 'secondary' : 'outline'}
                    size="sm"
                    aria-label={label}
                    onClick={() => void handleCopy(index, step.text)}
                    className="min-h-11 shrink-0 px-3 text-xs font-semibold"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 mr-1.5 text-primary" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 mr-1.5" />
                        <span>{label}</span>
                      </>
                    )}
                  </Button>
                </div>
              </li>
            )
          }

          if (step.type === 'image') {
            const photoItem = {
              id: step.mediaId,
              src: step.src,
              alt: step.alt,
            }
            return (
              <li
                key={index}
                className={`rounded-xl border p-3.5 sm:p-4 transition-colors space-y-3 ${
                  isCompleted ? 'bg-muted/30 border-muted-foreground/20' : 'bg-card border-border'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id={`step-check-${index}`}
                    aria-label={`단계 ${index + 1} 완료`}
                    checked={isCompleted}
                    onChange={() => toggleStepCompletion(index)}
                    className="mt-1 size-5 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <StepBadge stepNumber={stepNumber} />
                      <span className="font-bold text-sm text-foreground">
                        사진 {step.photoIndex} 저장
                      </span>
                      {isCompleted ? (
                        <span className="text-[11px] font-semibold text-primary">
                          완료됨
                        </span>
                      ) : null}
                    </div>

                    <NaverSinglePhotoSave
                      photo={photoItem}
                      photoIndex={step.photoIndex}
                      positionHint={step.positionHint}
                      onSaved={() => {
                        setCompletedSteps((prev) => {
                          const next = new Set(prev)
                          next.add(index)
                          return next
                        })
                      }}
                    />
                  </div>
                </div>
              </li>
            )
          }

          if (step.type === 'tags') {
            const label = `태그 ${step.count}개 복사`
            return (
              <li
                key={index}
                className={`rounded-xl border p-3.5 sm:p-4 transition-colors space-y-3 ${
                  isCompleted ? 'bg-muted/30 border-muted-foreground/20' : 'bg-card border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      id={`step-check-${index}`}
                      aria-label={`단계 ${index + 1} 완료`}
                      checked={isCompleted}
                      onChange={() => toggleStepCompletion(index)}
                      className="mt-1 size-5 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StepBadge stepNumber={stepNumber} />
                        <span className="font-bold text-sm text-foreground">{label}</span>
                        {isCompleted ? (
                          <span className="text-[11px] font-semibold text-primary">
                            완료됨
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground break-words font-medium">
                        {step.text || '설정된 태그가 없습니다'}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant={isCopied ? 'secondary' : 'outline'}
                    size="sm"
                    aria-label={label}
                    disabled={!step.text}
                    onClick={() => void handleCopy(index, step.text)}
                    className="min-h-11 shrink-0 px-3 text-xs font-semibold"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 mr-1.5 text-primary" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 mr-1.5" />
                        <span>{label}</span>
                      </>
                    )}
                  </Button>
                </div>
              </li>
            )
          }

          return null
        })}
      </ol>

      {/* Fallback Textarea Sheet for Clipboard Error */}
      {fallbackSheet ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-destructive">
              클립보드 접근이 차단되어 아래 텍스트를 직접 복사해 주세요
            </span>
            <button
              type="button"
              onClick={() => setFallbackSheet(null)}
              className="text-xs text-muted-foreground hover:underline"
            >
              닫기
            </button>
          </div>
          <textarea
            readOnly
            value={fallbackSheet.text}
            rows={4}
            className="w-full rounded-md border bg-card p-2 text-base md:text-sm font-mono select-all focus:outline-none"
          />
        </div>
      ) : null}

      {/* 발행 직전 확인 카드 */}
      <section aria-label="발행 직전 확인" className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Info className="size-4 text-primary" aria-hidden="true" />
            <span>발행 직전 확인</span>
          </h4>
          <p className="text-xs text-muted-foreground">
            소희가 추천하는 발행 설정값이에요. 네이버 글쓰기 화면에서 동일하게 설정해 주세요.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {/* 카테고리 추천 */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div>
              <span className="text-muted-foreground block text-[11px]">카테고리 추천</span>
              <span className="font-semibold text-foreground">{recommendedCategory}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(recommendedCategory)}
              className="min-h-11 px-2.5 text-xs"
              aria-label="카테고리 복사"
            >
              <Copy className="size-3.5 mr-1" />
              <span>복사</span>
            </Button>
          </div>

          {/* 공개 설정 */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div>
              <span className="text-muted-foreground block text-[11px]">공개 설정</span>
              <span className="font-semibold text-foreground">전체공개 권장</span>
            </div>
          </div>

          {/* 대표(썸네일) 사진 */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div>
              <span className="text-muted-foreground block text-[11px]">대표(썸네일) 사진</span>
              <span className="font-semibold text-foreground">{thumbnailPhotoLabel}</span>
            </div>
          </div>

          {/* 태그 안내 */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div>
              <span className="text-muted-foreground block text-[11px]">태그 입력</span>
              <span className="font-semibold text-foreground">태그 입력 칸에 붙여넣기</span>
            </div>
          </div>
        </div>

        {/* 2대 필수 경고 박스 */}
        <div className="rounded-xl border border-border bg-muted/40 p-3.5 sm:p-4 text-xs space-y-1.5">
          <p className="font-bold flex items-start gap-1.5 text-foreground">
            <AlertTriangle className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
            <span>네이버 앱에서 [등록]을 누르면 바로 발행돼요. 먼저 [저장]으로 임시저장해 확인하세요.</span>
          </p>
          <p className="text-muted-foreground pl-5.5">
            복사나 저장만으로 게시되지 않아요. 네이버 스마트에디터에서 내용을 확인한 뒤 발행해 주세요.
          </p>
        </div>
      </section>
    </div>
  )
}
