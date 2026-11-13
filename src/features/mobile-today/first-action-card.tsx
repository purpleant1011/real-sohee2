'use client'

import Link from 'next/link'
import { ArrowRight, Clock3, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MobileHomeDto } from '../mobile-decision/contracts'
import type { FirstAction } from './first-action'
import { pickFirstAction } from './first-action'

/** M09 폴드 안 단일 CTA. 조회 오류/미확인을 "할 일 없음"으로 바꾸지 않는다. */
export function FirstActionCard({ view, onRefresh, onDelegate }: {
  view: Pick<MobileHomeDto, 'decisions'>
  onRefresh: () => void
  onDelegate: () => void
}) {
  const action: FirstAction = pickFirstAction(view)

  if (action.kind === 'retry') {
    return (
      <section aria-label="다음 행동" className="space-y-3.5 rounded-[20px] border border-border/80 bg-card p-5 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">다음 할 일을 확인하지 못했어요</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">일시적인 연결 문제일 수 있어요. 할 일이 없는 것은 아니니 다시 확인해 보세요.</p>
        </div>
        <Button onClick={onRefresh} variant="outline" className="min-h-12 w-full gap-2 rounded-xl text-sm font-medium">
          <RefreshCw className="size-4" aria-hidden="true" />다시 확인하기
        </Button>
      </section>
    )
  }

  if (action.kind === 'delegate') {
    return (
      <section aria-label="다음 행동" className="space-y-3.5 rounded-[20px] border border-border/70 bg-card p-5 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">지금 확인하실 일은 없어요</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">다음에 할 일을 소희에게 맡겨 보세요.</p>
        </div>
        <Button onClick={onDelegate} className="min-h-12 w-full gap-2 rounded-xl text-base font-semibold">
          <ArrowRight className="size-4" aria-hidden="true" />소희에게 일 맡기기
        </Button>
      </section>
    )
  }

  if (action.kind === 'partial') {
    return (
      <section aria-label="다음 행동" className="space-y-3.5 rounded-[20px] border border-border/80 bg-card p-5 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">일부 문의를 아직 읽지 못했어요</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">확인이 필요한 업무가 남아 있을 수 있어요. 소통함에서 직접 확인해 주세요.</p>
        </div>
        <div className="space-y-2">
          <Link
            prefetch={false}
            href={action.href}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            소통함 열기<ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <Button onClick={onRefresh} variant="ghost" className="min-h-10 w-full gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-4" aria-hidden="true" />다시 확인
          </Button>
        </div>
      </section>
    )
  }

  if (action.kind === 'checking') {
    return (
      <section aria-label="다음 행동" className="space-y-3 rounded-[20px] border border-dashed border-border/80 bg-card/60 p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">다음 할 일을 확인하고 있어요</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">확인이 끝날 때까지 완료로 표시하지 않아요.</p>
        </div>
        <Button onClick={onRefresh} variant="outline" className="min-h-12 w-full gap-2 rounded-xl text-sm font-medium">
          <RefreshCw className="size-4" aria-hidden="true" />상태 다시 확인
        </Button>
      </section>
    )
  }

  return (
    <section aria-label="다음 행동" className="space-y-4 rounded-[20px] border border-primary/25 border-l-4 border-l-primary bg-accent/25 p-5 shadow-xs">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-primary">
            {action.stale ? (
              <><Clock3 className="size-3.5" aria-hidden="true" />마지막 확인 이후 바뀌었을 수 있어요</>
            ) : (
              '지금 확인할 일'
            )}
          </p>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            확인 필요
          </span>
        </div>
        <h2 className="break-words break-keep text-[19px] font-bold leading-snug tracking-tight text-foreground">{action.title}</h2>
        <p className="text-[13px] font-medium text-muted-foreground">{action.targetLabel}</p>
      </div>
      <Link
        prefetch={false}
        href={action.href}
        className="m-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
      >
        검토하기<ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  )
}
