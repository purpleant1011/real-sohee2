'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Pause, Play, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { describeAutonomy } from './autonomy-state'
import type { AutonomyController } from './use-autonomy'

/**
 * M24 소희 일하기(자율근무) 상태 및 제어.
 * 표시와 버튼은 서버 readback(actualMode/version)만 근거로 한다.
 * 중지 후에도 서버가 actualMode를 PAUSED로 확인해 줄 때까지 "적용 중"으로 표시한다.
 */
export function AutonomyControl({ controller, businessLabel = '소희', autonomyHref }: {
  controller: AutonomyController
  businessLabel?: string
  autonomyHref?: string
}) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const state = controller.load === 'ready' ? controller.state : null
  const view = describeAutonomy(state)

  async function toggle() {
    if (!view.primary || submitting) return
    setSubmitting(true)
    setMessage('')
    const result = await controller.setPaused(view.primary === 'pause')
    if (!result.ok) setMessage(result.message)
    else setMessage(view.primary === 'pause' ? '멈춤 요청을 보냈어요. 적용 상태를 확인하고 있어요.' : '시작 요청을 보냈어요. 적용 상태를 확인하고 있어요.')
    setSubmitting(false)
  }

  const displayLabel = controller.load === 'loading' && !state
    ? '상태를 확인하고 있어요'
    : view.label === '대기 중 · 새 일을 받을 수 있어요'
      ? `${businessLabel}가 일할 준비가 됐어요`
      : view.label

  const dotColor = (state && (state.killSwitchActive || state.actualMode === 'BLOCKED'))
    ? 'bg-state-danger'
    : (view.pending || controller.load === 'loading')
      ? 'bg-primary animate-pulse'
      : (state?.actualMode === 'PAUSED' || state?.actualMode === 'OFF')
        ? 'bg-muted-foreground/60'
        : 'bg-state-ok'

  return (
    <section aria-label="소희 일하기" className="space-y-2.5 rounded-2xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(20,16,40,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <span className={`size-2.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight text-foreground">
              {displayLabel}
            </h2>
            <span className="sr-only" role="status" aria-live="polite">
              소희 일하기 상태: {displayLabel}
            </span>
          </div>
        </div>

        {state && (state.killSwitchActive || state.actualMode === 'BLOCKED') ? (
          <span className="rounded-xl bg-muted p-1.5 text-muted-foreground">
            <ShieldAlert className="size-4" aria-hidden="true" />
          </span>
        ) : null}

        {view.primary ? (
          <Button
            size="sm"
            variant="outline"
            onClick={toggle}
            disabled={submitting || view.pending || controller.load === 'loading'}
            className="min-h-11 shrink-0 gap-1.5 rounded-xl px-3 text-xs font-medium"
          >
            {view.primary === 'pause' ? (
              <>
                <Pause className="size-3.5" aria-hidden="true" />
                <span>잠시 멈추기</span>
              </>
            ) : (
              <>
                <Play className="size-3.5" aria-hidden="true" />
                <span>다시 시작</span>
              </>
            )}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {state ? <span>마지막 확인 {formatObservedAt(state.observedAt)}</span> : null}
          {state && state.activeActionRunCount > 0 ? (
            <span>· 진행 중 작업 {state.activeActionRunCount}건</span>
          ) : null}
        </span>
        {autonomyHref ? (
          <Link
            prefetch={false}
            href={autonomyHref}
            className="inline-flex items-center gap-0.5 font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            일하는 방식 보기
            <ChevronRight className="size-3" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {state && view.pending ? (
        <p className="text-xs text-muted-foreground">변경이 확인되면 표시가 바뀌어요.</p>
      ) : null}

      {controller.load === 'error' ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-sm leading-relaxed">
            {controller.conflict ? controller.errorMessage : '소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.'}
          </p>
          <Button variant="outline" onClick={controller.refresh} className="min-h-11 w-full gap-2">
            <RefreshCw className="size-4" aria-hidden="true" />
            최신 상태 다시 확인
          </Button>
        </div>
      ) : null}

      {message ? <p role="status" className="text-xs leading-relaxed text-muted-foreground">{message}</p> : null}
    </section>
  )
}

/**
 * 서버(Node ICU)와 브라우저 ICU 의 `ko-KR` 시각 표기가 달라(`PM 06:00` vs `오후 06:00`)
 * 하이드레이션 pageerror 가 났다. 로케일 데이터에 의존하지 않고 직접 조립해 결정론적으로 만든다.
 * 표시 기준 시간대는 모바일 화면 규약과 동일하게 Asia/Seoul 로 고정한다.
 */
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
  // `en-US` + hour12:false 는 자정을 `24` 로 줄 수 있다.
  return `${hour === '24' ? '00' : hour}:${minute}`
}
