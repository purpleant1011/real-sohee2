'use client'

import React, { useMemo } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import {
  TEACH_TOPICS,
  buildTeachTopicPrompt,
  getNextTeachTopic,
  isTopicCovered,
  topicProgress,
} from './teach-model'

export interface TeachQuestionChipsProps {
  covered?: readonly string[] | ReadonlySet<string> | null
  onPick: (prompt: string) => void
  disabled?: boolean
  className?: string
}

/**
 * 소희 가르치기 7대 주제 칩.
 * 큼직한 터치 영역(min-h-11)으로 모바일 친화적이며,
 * 완료된 항목은 체크 및 뮤트 스타일, 다음 추천 주제는 primary로 강조된다.
 */
export function TeachQuestionChips({
  covered,
  onPick,
  disabled = false,
  className,
}: TeachQuestionChipsProps) {
  const coveredSet = useMemo(() => {
    if (!covered) return new Set<string>()
    if (covered instanceof Set) return covered
    return new Set(covered)
  }, [covered])

  const progress = topicProgress(covered)
  const nextTopic = getNextTeachTopic(covered)

  return (
    <div className={cn('space-y-3', className)} aria-label="소희 가르치기 주제 선택">
      {/* 얇은 진행선 및 "3/7 가르쳤어요" 카운터 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{`${progress.done}/${progress.total} 가르쳤어요`}</span>
          <span className="font-medium">
            {progress.done === progress.total
              ? '전체 완료'
              : `${Math.round((progress.done / progress.total) * 100)}%`}
          </span>
        </div>
        <Progress value={progress.done} max={progress.total} className="h-1.5" />
      </div>

      {/* 큼직한 칩 목록 */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="가르칠 주제 목록">
        {TEACH_TOPICS.map((topic) => {
          const isDone = isTopicCovered(topic.id, coveredSet)
          const isNext = !isDone && nextTopic?.id === topic.id

          return (
            <button
              key={topic.id}
              type="button"
              disabled={disabled}
              data-covered={isDone}
              data-next={isNext}
              aria-label={topic.label}
              onClick={() => onPick(buildTeachTopicPrompt(topic))}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all select-none',
                'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
                isDone && 'border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted/80',
                isNext && 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
                !isDone && !isNext && 'border-border bg-card text-foreground hover:bg-muted/40',
              )}
            >
              {isDone && (
                <Check
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span>{topic.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
