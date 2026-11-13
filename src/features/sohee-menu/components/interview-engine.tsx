'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import { Check, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  INTERVIEW_QUESTIONS,
  getNextInterviewQuestion,
  summarizeAnswer,
} from '@/features/sohee-interview/questions'

interface InterviewEngineProps {
  workspaceId: string
  onFactConfirmed: () => void
}

export function InterviewEngine({ workspaceId, onFactConfirmed }: InterviewEngineProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<string[]>([])
  const [isLoadingProgress, setIsLoadingProgress] = useState(true)
  const [answerInput, setAnswerInput] = useState('')
  const [confirmingAnswer, setConfirmingAnswer] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function fetchProgress() {
      setIsLoadingProgress(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/interview/progress`)
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        if (!json?.success || !isMounted) return

        const fetchedAnswered = Array.isArray(json?.data?.answeredQuestionIds)
          ? (json.data.answeredQuestionIds as string[])
          : []
        setAnsweredQuestionIds(fetchedAnswered)

        const next = getNextInterviewQuestion(fetchedAnswered)
        if (next) {
          const nextIdx = INTERVIEW_QUESTIONS.findIndex((q) => q.id === next.id)
          if (nextIdx !== -1) {
            setCurrentIndex(nextIdx)
          }
        } else if (
          fetchedAnswered.length >= INTERVIEW_QUESTIONS.length ||
          json?.data?.isCompleted
        ) {
          setCurrentIndex(INTERVIEW_QUESTIONS.length)
        }
      } catch (err) {
        console.error('[InterviewEngine] fetchProgress failed:', err)
      } finally {
        if (isMounted) {
          setIsLoadingProgress(false)
        }
      }
    }

    void fetchProgress()

    return () => {
      isMounted = false
    }
  }, [workspaceId])

  const isCompleted = currentIndex >= INTERVIEW_QUESTIONS.length
  const currentQuestion = !isCompleted ? INTERVIEW_QUESTIONS[currentIndex] : null
  const progressPercent = isCompleted
    ? 100
    : Math.round((Math.max(answeredQuestionIds.length, currentIndex) / INTERVIEW_QUESTIONS.length) * 100)

  const handleSelectQuestion = (index: number) => {
    setCurrentIndex(index)
    setConfirmingAnswer(null)
    setAnswerInput('')
    setErrorMessage(null)
  }

  const handleChipClick = (chip: string) => {
    setAnswerInput(chip)
  }

  const handleSubmitAnswer = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!answerInput.trim()) return
    setConfirmingAnswer(answerInput.trim())
    setErrorMessage(null)
  }

  const handleSkip = () => {
    setConfirmingAnswer(null)
    setAnswerInput('')
    setErrorMessage(null)
    setCurrentIndex((prev) => prev + 1)
  }

  const handleEditAgain = () => {
    setConfirmingAnswer(null)
    setErrorMessage(null)
  }

  const handleConfirmSave = async () => {
    if (!currentQuestion || !confirmingAnswer) return

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/interview/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          rawAnswer: confirmingAnswer,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        setErrorMessage('인터뷰 답변을 저장하지 못했어요. 다시 시도해 주세요.')
        return
      }

      onFactConfirmed()

      const newAnsweredIds = answeredQuestionIds.includes(currentQuestion.id)
        ? answeredQuestionIds
        : [...answeredQuestionIds, currentQuestion.id]
      setAnsweredQuestionIds(newAnsweredIds)

      setConfirmingAnswer(null)
      setAnswerInput('')

      const next = getNextInterviewQuestion(newAnsweredIds)
      if (next) {
        const nextIdx = INTERVIEW_QUESTIONS.findIndex((q) => q.id === next.id)
        setCurrentIndex(nextIdx !== -1 ? nextIdx : currentIndex + 1)
      } else {
        setCurrentIndex(INTERVIEW_QUESTIONS.length)
      }
    } catch {
      setErrorMessage('인터뷰 답변을 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // 상단 질문 진행 인디케이터 바
  const renderQuestionIndicators = () => (
    <div
      className="flex items-center gap-1.5 overflow-x-auto pb-1"
      role="tablist"
      aria-label="질문 목록"
    >
      {INTERVIEW_QUESTIONS.map((q, idx) => {
        const isCurrent = !isCompleted && currentIndex === idx
        const isAnswered = answeredQuestionIds.includes(q.id)
        const stepNumber = idx + 1

        return (
          <button
            key={q.id}
            type="button"
            role="button"
            aria-label={`질문 ${stepNumber}`}
            onClick={() => handleSelectQuestion(idx)}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border shrink-0 cursor-pointer',
              isCurrent
                ? 'bg-primary text-primary-foreground font-bold ring-2 ring-primary/40 border-primary shadow-sm'
                : isAnswered
                ? 'bg-state-ok-soft text-state-ok border-state-ok/40 hover:bg-state-ok/20'
                : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80',
            )}
          >
            {isAnswered && !isCurrent ? (
              <Check className="size-3 text-state-ok" aria-hidden />
            ) : null}
            <span>{`질문 ${stepNumber}`}</span>
          </button>
        )
      })}
    </div>
  )

  if (isCompleted) {
    return (
      <Card className="rounded-[20px] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="purple">완료</Badge>
            <span className="text-xs font-semibold text-muted-foreground">8/8</span>
            {isLoadingProgress && (
              <span className="text-[11px] text-muted-foreground animate-pulse">
                확인 중...
              </span>
            )}
          </div>
          <Progress value={100} className="w-24 h-1.5" aria-label="인터뷰 진행률" />
        </div>

        {renderQuestionIndicators()}

        <div className="flex items-start gap-4 pt-1">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl bg-primary/15 ring-2 ring-primary/20">
            <Image
              src="/brand/sohee-character-v1.png"
              alt="소희"
              width={48}
              height={48}
              className="size-full object-cover"
            />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-zinc-900">모든 인터뷰 질문을 마쳤어요</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              사장님이 알려주신 소중한 정보 덕분에 우리 가게를 훨씬 깊이 이해하게 되었어요. 새로운 내용이 생기면 위의 질문 번호를 눌러 언제든 다시 알려주세요!
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (!currentQuestion) return null

  return (
    <Card className="rounded-[20px] p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold">소희가 먼저 물어봐요</h3>
          <Badge variant="purple" className="text-[11px]">
            {`${currentIndex + 1}/${INTERVIEW_QUESTIONS.length}`}
          </Badge>
          {isLoadingProgress && (
            <span className="text-[11px] text-muted-foreground animate-pulse">
              확인 중...
            </span>
          )}
        </div>
        <Progress
          value={progressPercent}
          className="w-24 h-1.5"
          aria-label="인터뷰 진행률"
        />
      </div>

      {/* 질문 진행 인디케이터 바 */}
      {renderQuestionIndicators()}

      {/* 질문 말풍선 */}
      <div className="flex items-start gap-3">
        <div className="relative size-9 shrink-0 overflow-hidden rounded-full bg-primary/15 ring-2 ring-primary/20">
          <Image
            src="/brand/sohee-character-v1.png"
            alt="소희"
            width={36}
            height={36}
            className="size-full object-cover"
          />
        </div>
        <div className="bg-muted rounded-2xl rounded-tl-none p-4 max-w-[90%] text-sm leading-relaxed text-zinc-800">
          {currentQuestion.prompt}
        </div>
      </div>

      {/* 선택 칩 */}
      {confirmingAnswer === null && (
        <div className="pl-12 flex flex-wrap gap-2">
          {currentQuestion.chips.map((chip: string) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleChipClick(chip)}
              className="px-3.5 py-1.5 rounded-xl bg-background border border-border text-xs font-medium text-zinc-700 hover:border-primary hover:text-primary transition-colors cursor-pointer shadow-sm"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* "이렇게 이해했어요" 확인 카드 */}
      {confirmingAnswer !== null ? (
        <div className="ml-12 bg-accent rounded-2xl p-4.5 border border-primary/15 space-y-3">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            <span className="text-xs font-bold text-primary">이렇게 이해했어요</span>
          </div>
          <p className="text-sm text-zinc-800 font-medium leading-relaxed bg-background/80 p-3 rounded-xl border border-primary/10">
            {summarizeAnswer(currentQuestion, confirmingAnswer)}
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="text-xs font-semibold text-destructive bg-destructive/10 p-2.5 rounded-lg"
            >
              {errorMessage}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleConfirmSave}
              className="flex-1 h-10 font-bold"
            >
              {isSubmitting ? '저장하는 중...' : errorMessage ? '다시 시도' : '맞아요'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={handleEditAgain}
              className="flex-1 h-10 font-bold"
            >
              고칠래요
            </Button>
          </div>
        </div>
      ) : (
        /* 답변 입력창 */
        <form onSubmit={handleSubmitAnswer} className="pl-12 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={answerInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAnswerInput(e.target.value)}
              placeholder={currentQuestion.placeholder || '답변을 적어주세요'}
              className="h-10 text-sm"
            />
            <Button
              type="submit"
              disabled={!answerInput.trim()}
              className="h-10 px-4 font-bold shrink-0"
            >
              알려주기
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleSkip}
              className="h-10 px-3 text-xs text-muted-foreground hover:text-zinc-900 shrink-0"
            >
              건너뛰기
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

