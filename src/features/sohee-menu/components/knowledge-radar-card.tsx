'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  Lightbulb,
  Calendar,
  Compass,
  Send,
  CheckCircle2,
  Sparkles,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  KnowledgeIntelligenceResult,
  InquiryQuestion,
  SeasonTrigger,
  CompetitiveInsight,
} from '@/features/sohee-knowledge/types'

export interface KnowledgeRadarCardProps {
  workspaceId: string
  onFactCreated?: () => void
}

export function KnowledgeRadarCard({
  workspaceId,
  onFactCreated,
}: KnowledgeRadarCardProps) {
  const [data, setData] = useState<KnowledgeIntelligenceResult | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // 역질문 답변 상태
  const [answer, setAnswer] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function fetchIntelligence() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/intelligence`)
        if (!res.ok) {
          throw new Error('인텔리전스 정보를 불러오지 못했습니다.')
        }
        const json = await res.json()
        if (isMounted) {
          if (json.success && json.data) {
            setData(json.data)
          } else {
            setData(null)
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    if (workspaceId) {
      fetchIntelligence()
    }

    return () => {
      isMounted = false
    }
  }, [workspaceId])

  const handleChipClick = (chip: string) => {
    setAnswer(chip)
  }

  const handleSaveFact = async (inquiry: InquiryQuestion) => {
    if (!answer.trim() || isSubmitting) return

    try {
      setIsSubmitting(true)
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/facts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: inquiry.category || 'MENU',
          content: answer.trim(),
        }),
      })

      if (!res.ok) {
        throw new Error('지식 등록에 실패했습니다.')
      }

      setSuccessMessage('소희에게 새로운 지식을 알려주었어요! 다음 분석에 바로 반영할게요.')
      setAnswer('')
      onFactCreated?.()
    } catch (err) {
      alert(err instanceof Error ? err.message : '지식 등록 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inquiry = data?.inquiry
  const seasonTrigger = data?.seasonTrigger
  const competitiveInsight = data?.competitiveInsight
  const hasNoData = !inquiry && !seasonTrigger && !competitiveInsight

  return (
    <div className="relative overflow-hidden rounded-2xl border border-state-wait/30 bg-gradient-to-br from-state-wait-soft via-primary/10 to-background p-6 shadow-sm dark:from-slate-900 dark:to-slate-950">
      {/* 상단 헤더: 관제센터 타이틀 & 소희 아바타 */}
      <div className="flex items-center justify-between border-b border-state-wait/20 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-state-wait/20 shadow-sm">
            <Image
              src="/brand/sohee-character-v1.png"
              alt="소희"
              width={44}
              height={44}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                소희의 마케팅 레이더 & 역질문
              </h3>
              <Badge
                variant="outline"
                className="border-state-wait/40 bg-state-wait-soft text-xs font-semibold text-state-wait"
              >
                <Sparkles className="mr-1 h-3 w-3 animate-pulse text-state-wait" />
                지능 관제센터
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              사장님 매장의 지식을 실시간 분석해 결핍된 정보와 시즌 마케팅 기회를 먼저 챙겨드려요.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-state-wait">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>분석 중...</span>
          </div>
        )}
      </div>

      {/* 본문 콘텐츠 */}
      <div className="mt-5 space-y-4">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-state-wait" />
            <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
              소희가 매장의 지식과 주변 상권을 정밀 분석하고 있어요...
            </p>
          </div>
        )}

        {!loading && hasNoData && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-6 text-center dark:border-slate-800 dark:bg-slate-900/40">
            <Sparkles className="mx-auto h-8 w-8 text-state-wait" />
            <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              현재 새로운 역질문이 없어요.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              매장 지식이 충분히 학습되었거나 곧 새로운 마케팅 분석을 시작합니다.
            </p>
          </div>
        )}

        {!loading && !hasNoData && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 1) 💡 소희의 역질문 (Inquiry) */}
            <div className="flex flex-col justify-between rounded-xl border border-state-warn/30 bg-white/90 p-4.5 shadow-sm dark:bg-slate-900/80 lg:col-span-1">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-state-warn">
                    <Lightbulb className="h-4 w-4 text-state-warn" />
                    <span>💡 소희의 역질문</span>
                  </div>
                  {inquiry?.category && (
                    <Badge variant="secondary" className="text-[10px]">
                      {inquiry.category}
                    </Badge>
                  )}
                </div>

                {inquiry ? (
                  <>
                    <h4 className="mt-2 text-sm font-bold leading-snug text-slate-900 dark:text-slate-100">
                      소희가 궁금해요: {inquiry.question}
                    </h4>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {inquiry.reason}
                    </p>

                    {/* 추천 답변 칩 */}
                    {inquiry.suggestedChips && inquiry.suggestedChips.length > 0 && (
                      <div className="mt-3">
                        <span className="text-[11px] font-medium text-slate-400">
                          추천 답변 (클릭 시 자동 입력):
                        </span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {inquiry.suggestedChips.map((chip, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleChipClick(chip)}
                              className="rounded-lg border border-state-warn/30 bg-state-warn-soft px-2.5 py-1 text-xs font-medium text-state-warn transition-colors hover:bg-state-warn/10 hover:border-state-warn/50"
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-4 text-xs text-slate-500">
                    현재 대기 중인 역질문이 없습니다.
                  </p>
                )}
              </div>

              {inquiry && (
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {successMessage && (
                    <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-state-ok">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{successMessage}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder={inquiry.placeholder || '답변을 입력해주세요'}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSaveFact(inquiry)
                        }
                      }}
                      className="h-9 text-xs"
                      disabled={isSubmitting}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSaveFact(inquiry)}
                      disabled={!answer.trim() || isSubmitting}
                      className="h-9 shrink-0 gap-1 bg-state-warn px-3 text-xs font-medium text-state-warn-soft hover:bg-state-warn/90"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>알려주기</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 2) 🍁 시즌 & 이벤트 제안 (Seasonality) */}
            <div className="flex flex-col justify-between rounded-xl border border-state-danger/30 bg-white/90 p-4.5 shadow-sm dark:bg-slate-900/80 lg:col-span-1">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-state-danger">
                    <Calendar className="h-4 w-4 text-state-danger" />
                    <span>🍁 시즌 & 이벤트 제안</span>
                  </div>
                  {seasonTrigger?.seasonName && (
                    <Badge
                      variant="outline"
                      className="border-state-danger/40 bg-state-danger-soft text-[11px] font-semibold text-state-danger"
                    >
                      {seasonTrigger.seasonName}
                    </Badge>
                  )}
                </div>

                {seasonTrigger ? (
                  <>
                    <h4 className="mt-2.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                      {seasonTrigger.title}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {seasonTrigger.description}
                    </p>

                    <div className="mt-3 rounded-lg bg-state-danger-soft p-2.5">
                      <div className="flex items-start gap-1.5">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-danger" />
                        <span className="text-xs font-medium text-state-danger">
                          {seasonTrigger.actionPrompt}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-xs text-slate-500">
                    현재 등록된 시즌성 제안이 없습니다.
                  </p>
                )}
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">
                  매장 지식에 시즌 키워드를 추가하면 SNS 글에 자동 반영돼요.
                </span>
              </div>
            </div>

            {/* 3) ⚔️ 상권 경쟁력 팁 (Competitive) */}
            <div className="flex flex-col justify-between rounded-xl border border-state-wait/30 bg-white/90 p-4.5 shadow-sm dark:bg-slate-900/80 lg:col-span-1">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-state-wait">
                    <Compass className="h-4 w-4 text-state-wait" />
                    <span>⚔️ 상권 경쟁력 팁</span>
                  </div>
                  {competitiveInsight?.targetKeyword && (
                    <Badge
                      variant="secondary"
                      className="bg-state-wait-soft text-[10px] text-state-wait"
                    >
                      {competitiveInsight.targetKeyword}
                    </Badge>
                  )}
                </div>

                {competitiveInsight ? (
                  <>
                    <div className="mt-2.5">
                      <span className="text-[11px] font-semibold text-state-wait">
                        우리 동네에서 돋보이는 강점
                      </span>
                      <h4 className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                        {competitiveInsight.strengthHighlight}
                      </h4>
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {competitiveInsight.recommendation}
                    </p>
                  </>
                ) : (
                  <p className="mt-4 text-xs text-slate-500">
                    상권 비교 데이터 분석 중입니다.
                  </p>
                )}
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span>주변 상권 대비 차별화 지점을 지식으로 축적해 보세요.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
