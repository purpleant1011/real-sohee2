'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ConversationShell } from '@/features/chat/conversation-shell'
import type { TaskTimelineItem, TaskTimelineMessageArtifact, TaskTimelineStepStatus } from '@/features/chat/stream-events'
import type { ConversationMessage } from '@/features/chat/types'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'

const BASE_STEP_TITLES = [
  '가게 정보 확인',
  '문안 초안 쓰기',
  '이미지 만들기',
  '저장',
] as const

function getInitialSteps(state?: string): TaskTimelineItem[] {
  if (state === 'awaiting_approval') {
    return [
      { id: 'step-1', title: BASE_STEP_TITLES[0], status: 'completed' },
      { id: 'step-2', title: BASE_STEP_TITLES[1], status: 'awaiting_approval' },
      { id: 'step-3', title: BASE_STEP_TITLES[2], status: 'pending' },
      { id: 'step-4', title: BASE_STEP_TITLES[3], status: 'pending' },
    ]
  }

  if (state === 'failed') {
    return [
      { id: 'step-1', title: BASE_STEP_TITLES[0], status: 'completed' },
      { id: 'step-2', title: BASE_STEP_TITLES[1], status: 'failed' },
      { id: 'step-3', title: BASE_STEP_TITLES[2], status: 'pending' },
      { id: 'step-4', title: BASE_STEP_TITLES[3], status: 'pending' },
    ]
  }

  if (state === 'done') {
    return [
      { id: 'step-1', title: BASE_STEP_TITLES[0], status: 'completed' },
      { id: 'step-2', title: BASE_STEP_TITLES[1], status: 'completed' },
      { id: 'step-3', title: BASE_STEP_TITLES[2], status: 'completed' },
      { id: 'step-4', title: BASE_STEP_TITLES[3], status: 'completed' },
    ]
  }

  return [
    { id: 'step-1', title: BASE_STEP_TITLES[0], status: 'completed' },
    { id: 'step-2', title: BASE_STEP_TITLES[1], status: 'in_progress' },
    { id: 'step-3', title: BASE_STEP_TITLES[2], status: 'pending' },
    { id: 'step-4', title: BASE_STEP_TITLES[3], status: 'pending' },
  ]
}

export function MobileProgressPreview({ initialState }: { initialState?: string }) {
  const [steps, setSteps] = useState<TaskTimelineItem[]>(() => getInitialSteps(initialState))
  const { resolvedTheme, setTheme } = useTheme()

  function handleAdvance() {
    setSteps((currentSteps) => {
      const activeIndex = currentSteps.findIndex((s) => s.status === 'in_progress' || s.status === 'awaiting_approval' || s.status === 'failed')
      if (activeIndex === -1) {
        const allCompleted = currentSteps.every((s) => s.status === 'completed')
        if (allCompleted) {
          // 루프: 처음 상태로 복원
          return getInitialSteps()
        }
        // 첫 번째 pending을 in_progress로
        const firstPending = currentSteps.findIndex((s) => s.status === 'pending')
        if (firstPending !== -1) {
          return currentSteps.map((s, idx) => (idx === firstPending ? { ...s, status: 'in_progress' as TaskTimelineStepStatus } : s))
        }
        return currentSteps
      }

      // 현재 진행 단계를 completed로 바꾸고, 다음 단계를 in_progress로 변경
      return currentSteps.map((s, idx) => {
        if (idx === activeIndex) {
          return { ...s, status: 'completed' as TaskTimelineStepStatus }
        }
        if (idx === activeIndex + 1) {
          return { ...s, status: 'in_progress' as TaskTimelineStepStatus }
        }
        return s
      })
    })
  }

  function handleReset() {
    setSteps(getInitialSteps(initialState))
  }

  const completedSteps = steps.filter((s) => s.status === 'completed').length
  const allCompleted = steps.length > 0 && completedSteps === steps.length

  const timelineArtifact: TaskTimelineMessageArtifact = {
    id: 'timeline-fixture-1',
    kind: 'task_timeline',
    title: '소희의 작업 계획',
    totalSteps: steps.length,
    completedSteps,
    steps,
    isLive: true,
  }

  const assistantMessageId = 'msg-fixture-assistant-1'
  const assistantMessage: ConversationMessage = {
    id: assistantMessageId,
    workspaceId: '10000000-0000-4000-8000-000000000001',
    threadId: 'thread-fixture-1',
    role: 'sohee',
    content: allCompleted
      ? '모든 작업을 완료했어요! 작성된 원고와 이미지를 확인해 주세요.'
      : '사장님이 승인한 가게 정보로 문안과 이미지를 준비하고 있어요.',
    status: allCompleted ? 'completed' : 'streaming',
    workItemId: null,
    createdAt: '2026-11-03T00:00:00Z',
    completedAt: allCompleted ? '2026-11-03T00:01:00Z' : null,
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 개발 검증 헤더 */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              TEST FIXTURE
            </span>
            <h1 className="text-sm font-semibold">모바일 진행 목록 검증</h1>
          </div>
          <button
            type="button"
            aria-label="테마 전환"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted active:bg-muted"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            테마: {resolvedTheme === 'dark' ? '어둡게' : '밝게'}
          </button>
        </div>

        {/* 상태 변형 및 단계 진행 컨트롤 (모두 tap target >= 44px) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            className="min-h-11 px-4 text-sm font-medium"
            onClick={handleAdvance}
          >
            다음 단계로
          </Button>

          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-3 text-xs"
            onClick={handleReset}
          >
            초기화
          </Button>

          <div className="flex flex-wrap gap-1.5 border-l border-border pl-2">
            <Link
              href="/dev/mobile-progress"
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium ${
                !initialState ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'
              }`}
            >
              진행 중
            </Link>
            <Link
              href="/dev/mobile-progress?state=awaiting_approval"
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium ${
                initialState === 'awaiting_approval' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'
              }`}
            >
              승인 대기
            </Link>
            <Link
              href="/dev/mobile-progress?state=failed"
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium ${
                initialState === 'failed' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'
              }`}
            >
              실패
            </Link>
            <Link
              href="/dev/mobile-progress?state=done"
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium ${
                initialState === 'done' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'
              }`}
            >
              완료
            </Link>
          </div>
        </div>
      </header>

      {/* 모바일 R2 컨테이너 */}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-3 py-2">
        <MobileR2Provider enabled forceMobile>
          <ConversationShell
            workspaceId="10000000-0000-4000-8000-000000000001"
            directWorkHref="/app"
            threadTitle="블로그 원고 초안 작성"
            messages={[assistantMessage]}
            messageDetails={{
              [assistantMessageId]: {
                evidence: [],
                artifacts: [timelineArtifact],
              },
            }}
          />
        </MobileR2Provider>
      </main>
    </div>
  )
}
