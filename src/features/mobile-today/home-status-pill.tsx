'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Pause, Play, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { describeAutonomy, type AutonomyServerState, type AutonomyView } from './autonomy-state'
import type { AutonomyController } from './use-autonomy'

export interface HomeStatusPillProps {
  controller: AutonomyController
  autonomyHref: string
}

type PillStatusLabel = '일하는 중' | '잠시 멈춤' | '확인 중' | '확인 필요'

interface PillStatus {
  label: PillStatusLabel
  dotClass: string
}

function resolvePillStatus(
  controller: AutonomyController,
  state: AutonomyServerState | null,
  view: AutonomyView,
): PillStatus {
  if (controller.load === 'error') {
    return { label: '확인 필요', dotClass: 'bg-state-warn' }
  }
  if (!state || controller.load === 'loading' || view.pending) {
    return { label: '확인 중', dotClass: 'bg-state-warn animate-pulse' }
  }
  if (state.killSwitchActive || state.actualMode === 'BLOCKED') {
    return { label: '확인 필요', dotClass: 'bg-state-warn' }
  }
  if (state.actualMode === 'PAUSED' || state.actualMode === 'OFF') {
    return { label: '잠시 멈춤', dotClass: 'bg-muted-foreground/60' }
  }
  return { label: '일하는 중', dotClass: 'bg-state-ok' }
}

const OBSERVED_AT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatObservedAt(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '시각 확인 필요'
  const parts = OBSERVED_AT_FORMAT.formatToParts(new Date(parsed))
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
  if (!hour || !minute) return '시각 확인 필요'
  return `${hour === '24' ? '00' : hour}:${minute}`
}

/**
 * 오늘 화면 헤더 우측 상태 알약 버튼.
 * 누르면 바텀시트가 열려 소희 일하기 상태와 제어를 제공한다.
 */
export function HomeStatusPill({ controller, autonomyHref }: HomeStatusPillProps) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const state = controller.load === 'ready' ? controller.state : null
  const view = describeAutonomy(state)
  const pill = resolvePillStatus(controller, state, view)

  async function toggle() {
    if (!view.primary || submitting) return
    setSubmitting(true)
    setMessage('')
    const result = await controller.setPaused(view.primary === 'pause')
    if (!result.ok) {
      setMessage(result.message)
    } else {
      setMessage(
        view.primary === 'pause'
          ? '멈춤 요청을 보냈어요. 적용 상태를 확인하고 있어요.'
          : '시작 요청을 보냈어요. 적용 상태를 확인하고 있어요.',
      )
    }
    setSubmitting(false)
  }

  const displayLabel =
    controller.load === 'loading' && !state
      ? '상태를 확인하고 있어요'
      : view.label === '대기 중 · 새 일을 받을 수 있어요'
        ? '소희가 일할 준비가 됐어요'
        : view.label

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`소희 일하기 상태: ${pill.label}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted/60 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className={cn('size-2 rounded-full', pill.dotClass)} aria-hidden="true" />
          <span>{pill.label}</span>
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[20px] p-6">
        <SheetHeader className="text-left">
          <SheetTitle>소희 일하기</SheetTitle>
          <SheetDescription className="text-xs">소희가 일하는 상태를 확인하고 켜거나 멈출 수 있어요.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 pt-2">
          {/* 상태 요약 박스 */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className={cn('size-2.5 shrink-0 rounded-full', pill.dotClass)} aria-hidden="true" />
                <h3 className="text-[15px] font-semibold leading-tight text-foreground">
                  {displayLabel}
                </h3>
                <span className="sr-only" role="status" aria-live="polite">
                  소희 일하기 상태: {displayLabel}
                </span>
              </div>
              {state && (state.killSwitchActive || state.actualMode === 'BLOCKED') ? (
                <span className="rounded-xl bg-muted p-1.5 text-muted-foreground">
                  <ShieldAlert aria-hidden="true" />
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {state ? <span>마지막 확인 {formatObservedAt(state.observedAt)}</span> : null}
              {state && state.activeActionRunCount > 0 ? (
                <span>· 진행 중 작업 {state.activeActionRunCount}건</span>
              ) : null}
            </div>

            {state && view.pending ? (
              <p className="text-xs text-muted-foreground">변경이 확인되면 표시가 바뀌어요.</p>
            ) : null}
          </div>

          {/* 제어 버튼 */}
          {view.primary ? (
            <Button
              variant="outline"
              onClick={toggle}
              disabled={submitting || view.pending || controller.load === 'loading'}
              className="min-h-11 w-full gap-2 rounded-xl text-sm font-medium"
            >
              {view.primary === 'pause' ? (
                <>
                  <Pause aria-hidden="true" />
                  <span>잠시 멈추기</span>
                </>
              ) : (
                <>
                  <Play aria-hidden="true" />
                  <span>다시 시작</span>
                </>
              )}
            </Button>
          ) : null}

          {/* 에러 처리 */}
          {controller.load === 'error' ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3">
              <p className="text-sm leading-relaxed text-foreground">
                {controller.conflict
                  ? controller.errorMessage
                  : '소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.'}
              </p>
              <Button variant="outline" onClick={controller.refresh} className="min-h-11 w-full gap-2">
                <RefreshCw aria-hidden="true" />
                <span>최신 상태 다시 확인</span>
              </Button>
            </div>
          ) : null}

          {/* 처리 상태 메시지 */}
          {message ? (
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              {message}
            </p>
          ) : null}

          {/* 일하는 방식 보기 링크 */}
          {autonomyHref ? (
            <Link
              prefetch={false}
              href={autonomyHref}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-between rounded-xl border border-border/70 bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span>일하는 방식 보기</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
