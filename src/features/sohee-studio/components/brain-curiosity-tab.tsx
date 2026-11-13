'use client'

import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  Clock,
  HelpCircle,
  Lightbulb,
  MessageSquarePlus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { CuriosityItem } from '../types'

interface BrainCuriosityTabProps {
  workspaceId: string
  onAnswerQuestion: (question: CuriosityItem) => void
  onRefreshTrigger?: number
}

export function BrainCuriosityTab({
  workspaceId,
  onAnswerQuestion,
  onRefreshTrigger = 0,
}: BrainCuriosityTabProps) {
  const [questions, setQuestions] = useState<CuriosityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchQuestions = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/questions`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      if (json.success && Array.isArray(json.data)) {
        setQuestions(json.data)
      } else {
        throw new Error(json.message || '질문 목록 조회 실패')
      }
    } catch (err: any) {
      console.error('Failed to fetch curiosity questions:', err)
      setError('질문 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchQuestions()
  }, [workspaceId, onRefreshTrigger])

  const handleSnooze = async (id: string) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/questions/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'snoozed' }),
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      if (json.success === false) {
        throw new Error(json.message || '보류 처리 실패')
      }
      setQuestions((prev) => prev.filter((q) => q.id !== id))
    } catch (err: any) {
      console.error('Failed to snooze question:', err)
      setActionError('질문 보류 처리에 실패했습니다. 다시 시도해 주세요.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 flex items-start gap-2">
        <Sparkles className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="space-y-0.5">
          <p className="font-bold">소희의 지식 탐구 큐</p>
          <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
            소희가 효과적인 마케팅과 정확한 고객 응대를 위해 사장님께 꼭 여쭤보고 싶은 내용들이에요.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/20">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
          <AlertCircle className="size-8 mx-auto text-destructive" />
          <p className="text-xs font-semibold text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchQuestions()}
            className="text-xs"
          >
            <RefreshCw className="size-3 mr-1" />
            다시 시도
          </Button>
        </Card>
      ) : questions.length === 0 ? (
        <Card className="rounded-xl border border-dashed p-6 text-center space-y-2">
          <Check className="size-8 mx-auto text-emerald-500" />
          <p className="text-xs font-semibold text-foreground">
            소희의 궁금증이 모두 해결되었어요!
          </p>
          <p className="text-[11px] text-muted-foreground">
            필요한 정보가 생기면 소희가 스스로 질문을 정리해서 여기에 알려드릴게요.
          </p>
        </Card>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
          {questions.map((q) => (
            <Card
              key={q.id}
              className="rounded-xl border border-border p-4 space-y-3 bg-card/60 hover:border-amber-300 dark:hover:border-amber-800 transition-all"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      q.priority === 'blocking'
                        ? 'border-destructive/40 text-destructive bg-destructive/5'
                        : 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:bg-amber-950/50'
                    }`}
                  >
                    {q.priority === 'blocking' ? '필수 확인' : '중요 탐구'}
                  </Badge>
                </div>
                <h4 className="text-xs font-bold text-foreground leading-snug">
                  &ldquo;{q.question}&rdquo;
                </h4>
              </div>

              <div className="rounded-lg bg-muted/40 p-2 text-[11px] space-y-1 border border-border/40">
                <div className="flex items-center gap-1 font-semibold text-muted-foreground">
                  <Lightbulb className="size-3 text-amber-500" />
                  <span>여쭤보는 이유</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">{q.reason}</p>
                {q.expectedOutcome && (
                  <p className="text-emerald-600 dark:text-emerald-400 font-medium pt-0.5">
                    효과: {q.expectedOutcome}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSnooze(q.id)}
                  className="h-7 text-xs px-2.5 text-muted-foreground"
                >
                  나중에
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAnswerQuestion(q)}
                  className="h-7 text-xs px-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  <MessageSquarePlus className="size-3.5 mr-1" />
                  대화로 답하기
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
