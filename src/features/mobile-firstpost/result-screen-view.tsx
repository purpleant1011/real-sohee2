'use client'

import { useId } from 'react'
import { StateView, StatusPill, type StateKind, type StatusPillKind } from '@/components/mobile-ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildResultScreen,
  type ResultActionItem,
  type ResultCardState,
  type ResultChannelCard,
  type ResultScreenInput,
} from './result-screen'

/**
 * M08 첫 결과와 증거 화면 (ANI-1681).
 * 게시 상태는 result-screen.ts 가 판정한 값을 그대로 옮긴다. 이 화면은 상태를 올리지 않는다.
 */
export type ResultScreenViewProps = Readonly<{
  input: ResultScreenInput
  load?: StateKind
  checkedAt?: string | null
  /** 새로고침·재시도·복사 등. 실행은 호출 측이 맡는다. */
  onAction?: (item: ResultActionItem) => void
  onRetryLoad?: () => void
}>

const PILL: Record<ResultCardState, StatusPillKind> = {
  VERIFIED: 'verified',
  CHECKING: 'checking_external',
  UNKNOWN: 'review',
  FAILED: 'action_needed',
  MANUAL: 'draft',
}

export function ResultScreenView({ input, load = 'ready', checkedAt, onAction, onRetryLoad }: ResultScreenViewProps) {
  const screen = buildResultScreen(input)
  const actions = [screen.primaryAction, screen.secondaryAction].filter((a): a is ResultActionItem => a !== null)
  const bottomUnconnectedNoticeId = useId()
  const hasUnconnectedBottomAction = !onAction && actions.some((a) => !a.href)

  return (
    <StateView
      kind={load}
      checkedAt={checkedAt}
      skeleton="detail"
      action={onRetryLoad ? <Button variant="outline" className="min-h-11" onClick={onRetryLoad}>다시 확인</Button> : undefined}
    >
      <section data-first-post-result aria-label="첫 게시 결과" className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{screen.title}</h2>
          {screen.completionToast ? (
            <p role="status" className="text-sm font-medium text-state-ok">{screen.completionToast}</p>
          ) : null}
        </header>

        <ul className="space-y-3">
          {screen.cards.map((card) => (
            <ResultCard key={card.channel} card={card} onAction={onAction} />
          ))}
        </ul>

        {screen.pendingNote ? <p className="text-sm text-muted-foreground">{screen.pendingNote}</p> : null}
        {screen.manualNotice ? <p className="text-sm text-muted-foreground">{screen.manualNotice}</p> : null}

        {actions.length > 0 ? (
          <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
            {actions.map((a, i) =>
              // 실제 주소가 있는 행동(게시물 보기·고객에게 보일 링크)은 누를 수 없는 버튼으로 두지 않는다.
              a.href ? (
                <a
                  key={a.action}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: i === 0 ? 'default' : 'outline' }), 'min-h-11 w-full')}
                >
                  {a.label}
                </a>
              ) : (
                <Button
                  key={a.action}
                  variant={i === 0 ? 'default' : 'outline'}
                  className="min-h-11 w-full"
                  disabled={!onAction}
                  title={!onAction ? '아직 이 동작이 연결되지 않았어요' : undefined}
                  aria-describedby={!onAction ? bottomUnconnectedNoticeId : undefined}
                  onClick={() => onAction?.(a)}
                >
                  {a.label}
                </Button>
              ),
            )}
            {hasUnconnectedBottomAction ? (
              <p id={bottomUnconnectedNoticeId} className="text-center text-xs text-muted-foreground">
                일부 동작은 아직 연결되지 않았어요.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </StateView>
  )
}

function ResultCard({ card, onAction }: Readonly<{ card: ResultChannelCard; onAction?: (item: ResultActionItem) => void }>) {
  const cardUnconnectedNoticeId = useId()
  const hasUnconnectedCardAction = !onAction && card.actions.some((a) => !a.href)

  return (
    <li className="space-y-2 rounded-2xl border border-border p-3" data-state={card.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{card.name}</span>
        <StatusPill kind={PILL[card.state]} label={card.label} />
      </div>
      <p className="text-sm text-muted-foreground">{card.detail}</p>
      {card.accountLabel ? <p className="text-sm">{card.accountLabel}</p> : null}
      {card.postedAtLabel ? <p className="text-xs tabular-nums text-muted-foreground">{card.postedAtLabel}</p> : null}
      {card.nextCheck ? <p className="text-xs text-muted-foreground">{card.nextCheck}</p> : null}
      {card.manualNotice ? <p className="text-xs text-muted-foreground">{card.manualNotice}</p> : null}
      {card.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {card.actions.map((a) =>
            a.href ? (
              <a key={a.action} href={a.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium">
                {a.label}
              </a>
            ) : (
              <Button
                key={a.action}
                variant="outline"
                className="min-h-11"
                disabled={!onAction}
                title={!onAction ? '아직 이 동작이 연결되지 않았어요' : undefined}
                aria-describedby={!onAction ? cardUnconnectedNoticeId : undefined}
                onClick={() => onAction?.(a)}
              >
                {a.label}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {hasUnconnectedCardAction ? (
        <p id={cardUnconnectedNoticeId} className="text-xs text-muted-foreground">
          일부 동작은 아직 연결되지 않았어요.
        </p>
      ) : null}
    </li>
  )
}
