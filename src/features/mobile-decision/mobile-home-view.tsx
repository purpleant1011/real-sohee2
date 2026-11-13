'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ChevronRight, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DecisionCard } from '@/components/mobile-ui'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { AutonomyControl } from '@/features/mobile-today/autonomy-control'
import { useAutonomy, type AutonomyController } from '@/features/mobile-today/use-autonomy'
import type { MobileHomeDto } from './contracts'
import { confirmedEmpty, metricText, selectDecisions } from './selectors'
import { rememberDecisionClick, useRestoreDecisionPosition } from './decision-return'

function day(view: MobileHomeDto): string {
  if (!view.timeZone) return '매장 시간대 확인 필요'
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: view.timeZone,
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date(view.generatedAt))
  } catch {
    return '날짜 확인 필요'
  }
}

const labels = {
  dm_reply: '메시지',
  comment_reply: '댓글',
  post_publish: '콘텐츠',
  proposal: '소희 제안',
}

/**
 * `autonomy` 를 넘기면 서버 readback 조회 없이 그 제어기만 쓴다.
 * 예시 마운트처럼 조회를 보내면 안 되는 곳에서만 쓴다(실화면은 넘기지 않는다).
 */
export interface HomeSlots {
  /** 인사 헤더 바로 아래(핵심 한 장). */
  lead?: ReactNode
  /** 상태 카드 아래(바로가기 등). */
  afterStatus?: ReactNode
}

export function MobileHomeView({ view, onRefresh, onDelegate, autonomy, lead, afterStatus }: {
  view: MobileHomeDto
  onRefresh: () => void
  onDelegate: () => void
  autonomy?: AutonomyController
} & HomeSlots) {
  return autonomy
    ? <HomeViewBody view={view} onRefresh={onRefresh} onDelegate={onDelegate} autonomy={autonomy} lead={lead} afterStatus={afterStatus} />
    : <ConnectedHomeView view={view} onRefresh={onRefresh} onDelegate={onDelegate} lead={lead} afterStatus={afterStatus} />
}

function ConnectedHomeView({ view, onRefresh, onDelegate, lead, afterStatus }: {
  view: MobileHomeDto
  onRefresh: () => void
  onDelegate: () => void
} & HomeSlots) {
  return (
    <HomeViewBody
      view={view}
      onRefresh={onRefresh}
      onDelegate={onDelegate}
      autonomy={useAutonomy(view.workspaceId)}
      lead={lead}
      afterStatus={afterStatus}
    />
  )
}

function HomeViewBody({ view, onRefresh, onDelegate, autonomy, lead, afterStatus }: {
  view: MobileHomeDto
  onRefresh: () => void
  onDelegate: () => void
  autonomy: AutonomyController
} & HomeSlots) {
  const decisions = view.decisions.data
  const pending = selectDecisions(decisions?.items ?? [])
  const recent = view.activity.data?.slice(0, 3) ?? []
  useRestoreDecisionPosition(view.workspaceId, decisions !== null)

  // R2(플래그 ON·767px 이하)에서만 M24 자율근무 화면으로 보낸다.
  // PC·플래그 OFF 는 기존 '내 소희' 경로 그대로다(ANI-1770 잔여).
  const autonomyHref = useMobileR2Active()
    ? '/app/account/automation'
    : '/app/sohee?tab=work&section=autonomy'

  const hasDecisionTotal = decisions?.total !== null && decisions?.total !== undefined

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-6 text-foreground">
      {/* 1. 헤더: 날짜·가게(작은 줄) + 큰 제목 '오늘, 소희와 함께' + 한 줄 보조 설명 */}
      <header className="space-y-1.5 pt-1">
        <p className="text-xs font-medium text-muted-foreground">
          {day(view)}{view.businessName ? ` · ${view.businessName}` : ''}
        </p>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight">오늘, 소희와 함께</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          필요한 결정만 확인하고, 나머지는 차근차근 맡겨 보세요.
        </p>
      </header>

      {lead}

      {/* 2. 소희 일하기 컴팩트 상태 카드 (상태 + 보조줄 + 작은 버튼 + 일하는 방식 보기 통합) */}
      <AutonomyControl controller={autonomy} autonomyHref={autonomyHref} />

      {afterStatus}

      {/* 3. 지금 확인할 일: 제목 옆 건수(확인된 값일 때만) + 전체 보기 링크 */}
      {!(lead && view.decisions.state === 'ready' && pending.length <= 1) && <section aria-label="필요한 결정" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight">
            지금 확인할 일
            {hasDecisionTotal ? <span className="ml-2 font-bold text-primary">{decisions.total}</span> : null}
          </h2>
          <Link
            prefetch={false}
            href="/app/approvals"
            className="inline-flex min-h-10 shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            전체 보기
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        {view.decisions.state === 'error' && (
          <div role="status" className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[15px] font-medium">확인할 일을 불러오지 못했어요</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              잠시 후 다시 확인해 주세요. 없는 것으로 보지는 않아요.
            </p>
            <Button variant="outline" size="sm" onClick={onRefresh} className="mt-3 min-h-9 text-xs">
              다시 확인하기
            </Button>
          </div>
        )}

        {view.decisions.state === 'loading' && (
          <p role="status" className="rounded-2xl border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
            확인할 일을 불러오고 있어요.
          </p>
        )}

        {view.decisions.state === 'stale' && (
          <p role="status" className="text-xs text-muted-foreground">
            업데이트 필요 · 새 정보를 확인한 뒤 검토해 주세요.
          </p>
        )}

        {confirmedEmpty(view.decisions) && (
          <Card className="gap-0 rounded-2xl border-border/70 py-0 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-[15px] font-medium">지금 확인하실 일은 없어요</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  새 소식을 맡기거나 기존 작업을 살펴보세요.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {pending.length > 0 ? (
          <div className="space-y-2.5">
            {pending.map((item) => (
              <DecisionCard
                key={item.id}
                id={`mobile-decision-${item.id}`}
                href={`/app/approvals?item=${encodeURIComponent(item.id)}`}
                kindLabel={labels[item.kind]}
                targetLabel={item.targetLabel}
                title={item.title}
                onNavigate={(event) => rememberDecisionClick(event, view.workspaceId, item.id)}
              />
            ))}
          </div>
        ) : null}

        {!confirmedEmpty(view.decisions) && !pending.length && !['error', 'loading', 'stale'].includes(view.decisions.state) && (
          <p className="rounded-2xl bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
            전체 업무 상태는 아직 확인 중이에요. 조회된 기록이 없다고 업무가 없는 것은 아니에요.
          </p>
        )}

        {decisions && !decisions.complete && pending.length > 0 && (
          <p className="text-xs text-muted-foreground">
            확인된 항목만 보여드려요. 전체 목록과 연결 상태를 함께 확인해 주세요.
          </p>
        )}
      </section>}

      {/* 4-A. 소희의 업무 기록: 보조 라벨 헤더 + 둥근 컨테이너 안 divide-y */}
      <section aria-label="최근 업무" className="space-y-2">
        <h2 className="px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">소희의 업무 기록</h2>
        {recent.length > 0 ? (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card px-4 shadow-[0_1px_2px_rgba(20,16,40,0.03)]">
            {recent.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3.5">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-snug">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.statusLabel}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {view.activity.state === 'stale' && (
          <p role="status" className="text-xs text-muted-foreground">업데이트 필요 · 마지막으로 확인한 기록이에요.</p>
        )}
        {view.activity.state === 'loading' && (
          <p role="status" className="rounded-2xl border border-dashed border-border/70 p-4 text-xs leading-relaxed text-muted-foreground">
            업무 기록을 확인하고 있어요.
          </p>
        )}
        {view.activity.state === 'unknown' && (
          <p className="rounded-2xl border border-dashed border-border/70 p-4 text-xs leading-relaxed text-muted-foreground">
            업무 기록 연결을 확인하고 있어요. 확인되지 않은 작업을 완료로 표시하지 않아요.
          </p>
        )}
        {view.activity.state === 'error' && (
          <div role="status" className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[15px] font-medium">업무 기록을 불러오지 못했어요</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              잠시 후 다시 확인해 주세요. 없는 것으로 보지는 않아요.
            </p>
            <Button variant="outline" size="sm" onClick={onRefresh} className="mt-3 min-h-9 text-xs">
              다시 확인하기
            </Button>
          </div>
        )}
        {view.activity.state === 'ready' && recent.length === 0 && (
          <p className="rounded-2xl border border-border/70 bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            아직 최근 작업 기록이 없어요. 첫 소식을 맡기면 여기에 기록돼요.
          </p>
        )}
      </section>

      {/* 4-B. 확인된 결과: 보조 라벨 헤더 + 둥근 컨테이너 안 divide-y */}
      <section aria-label="검증된 결과" className="space-y-2">
        <h2 className="px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">확인된 결과</h2>
        {view.results.state === 'ready' && view.results.data?.length ? (
          <dl className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card px-4 shadow-[0_1px_2px_rgba(20,16,40,0.03)]">
            {view.results.data.map((metric) => (
              <div key={metric.id} className="flex flex-wrap items-center justify-between gap-2 py-3.5">
                <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">{metricText(metric)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="rounded-2xl border border-border/70 bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            확인된 결과가 생기면 여기에 보여드려요.
          </p>
        )}
        <div className="pt-0.5">
          <Link
            prefetch={false}
            href="/app/results"
            className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            성과와 근거 살펴보기
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 5. 다음 소식도 소희에게 (간결한 안내 문구 + 사진 업로드 비활성 버튼 제거) */}
      <section aria-label="새 업무 맡기기" className="space-y-3 rounded-2xl bg-muted/50 p-5">
        <h2 className="text-[15px] font-semibold text-foreground">다음 소식도 소희에게</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          가게 소식이나 원하는 목표를 알려 주세요. 실행이 필요한 일은 준비 상태부터 확인해요.
        </p>
        <Button onClick={onDelegate} className="min-h-12 w-full gap-2 text-[15px] font-semibold dark:text-background">
          소희에게 소식 맡기기
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </section>
    </div>
  )
}
