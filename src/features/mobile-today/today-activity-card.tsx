'use client'

import Link from 'next/link'
import { Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { StatusPill, type StatusPillKind } from '@/components/mobile-ui'
import type { MobileActivity, MobileHomeDto } from '../mobile-decision/contracts'
import { formatTodayMetricText, resolveTodayResultsPresentation } from './today-metric-presentation'

export function formatActivityTitle(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > 40) {
    return trimmed.slice(0, 40) + '…'
  }
  return trimmed
}

export function resolveActivityStatusKind(statusLabel: string): StatusPillKind {
  const lower = statusLabel.toLowerCase().trim()
  if (lower.includes('대기') || lower.includes('검토')) return 'awaiting_approval'
  if (lower.includes('확인 전') || lower.includes('확인 중') || lower.includes('진행 중') || lower.includes('발송 중')) return 'checking_external'
  if (lower.includes('완료') || lower.includes('확인됨') || lower.includes('게시됨') || lower.includes('발행')) return 'verified'
  if (lower.includes('초안') || lower.includes('준비')) return 'draft'
  if (lower.includes('중단')) return 'stopped'
  if (lower.includes('실패') || lower.includes('오류') || lower.includes('필요')) return 'action_needed'
  return 'verified'
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getActivityHref(item: Pick<MobileActivity, 'id' | 'statusLabel'> & { title?: string }): string {
  const id = item.id.trim()
  const status = item.statusLabel.trim()
  const title = (item.title ?? '').trim()

  if (id.startsWith('content:')) {
    const rawId = id.slice('content:'.length).trim()
    if (UUID_REGEX.test(rawId)) {
      return `/app/work/${rawId}`
    }
    return '/app/content'
  }

  if (status.includes('승인 대기') || status.includes('승인') || status.includes('검토')) {
    return `/app/approvals?item=${encodeURIComponent(id)}`
  }
  if (status.includes('게시 완료') || status.includes('발행 완료') || status.includes('게시됨') || status.includes('발행')) {
    return '/app/content'
  }
  if (status.includes('답변') || title.includes('댓글') || title.includes('문의') || title.includes('소통')) {
    return '/app/engagement'
  }
  if (status.includes('예약') || title.includes('예약') || title.includes('알림톡')) {
    return '/app/schedule'
  }
  return '/app/content'
}

/**
 * 소희의 최근 활동 기록과 확인된 성과를 한 장의 카드로 요약하는 컴포넌트.
 * 사실 구분을 유지하며 로딩/오류를 '없음'으로 치환하지 않는다.
 */
export function TodayActivityCard({
  view,
  onRefresh,
}: {
  view: Pick<MobileHomeDto, 'activity' | 'results'>
  onRefresh: () => void
}) {
  const recent =
    (view.activity.state === 'ready' || view.activity.state === 'stale') && view.activity.data
      ? view.activity.data.slice(0, 3)
      : []

  const hasReadyResults =
    view.results.state === 'ready' && Array.isArray(view.results.data) && view.results.data.length > 0

  const resultsPresentation = hasReadyResults
    ? resolveTodayResultsPresentation(view.results.data!.slice(0, 3))
    : null

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-border/70 p-4 shadow-[0_1px_2px_rgba(20,16,40,0.03)]">
      <CardHeader className="flex flex-row items-center justify-between p-0">
        <CardTitle role="heading" aria-level={3} className="text-[15px] font-semibold tracking-tight text-foreground">
          소희가 한 일
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3.5 p-0">
        {/* 최근 업무 기록 */}
        {recent.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border/60">
            {recent.map((item) => (
              <li key={item.id}>
                <Link
                  prefetch={false}
                  href={getActivityHref(item)}
                  className="group flex min-h-12 items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-muted-foreground group-hover:text-primary [&_svg]:size-4">
                      <Clock3 aria-hidden="true" />
                    </span>
                    <span className="truncate break-keep text-sm font-medium leading-snug text-foreground group-hover:text-primary">
                      {formatActivityTitle(item.title)}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <StatusPill
                      kind={resolveActivityStatusKind(item.statusLabel)}
                      label={item.statusLabel}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {view.activity.state === 'stale' && (
          <p role="status" className="text-xs text-muted-foreground">
            다시 확인이 필요해요 · 마지막으로 확인한 기록이에요.
          </p>
        )}

        {view.activity.state === 'loading' && (
          <p
            role="status"
            className="rounded-xl border border-dashed border-border/70 p-3 text-xs leading-relaxed text-muted-foreground"
          >
            업무 기록을 확인하고 있어요.
          </p>
        )}

        {view.activity.state === 'unknown' && (
          <p className="rounded-xl border border-dashed border-border/70 p-3 text-xs leading-relaxed text-muted-foreground">
            업무 기록 연결을 확인하고 있어요. 확인되지 않은 작업을 완료로 표시하지 않아요.
          </p>
        )}

        {view.activity.state === 'error' && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
            <div role="status" className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">업무 기록을 불러오지 못했어요</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                잠시 후 다시 확인해 주세요. 기록이 없다는 뜻은 아니에요.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} className="w-fit min-h-11 text-xs">
              다시 확인하기
            </Button>
          </div>
        )}

        {view.activity.state === 'ready' && recent.length === 0 && (
          <p className="rounded-xl border border-border/70 bg-card p-3 text-xs leading-relaxed text-muted-foreground">
            아직 최근 작업 기록이 없어요. 첫 소식을 맡기면 여기에 기록돼요.
          </p>
        )}

        <Separator className="bg-border/60" />

        {/* 확인된 결과 */}
        {hasReadyResults && resultsPresentation ? (
          <div className="flex flex-col gap-2">
            <div
              className={`grid gap-2 ${
                resultsPresentation.items.length === 1
                  ? 'grid-cols-1'
                  : resultsPresentation.items.length === 2
                    ? 'grid-cols-2'
                    : 'grid-cols-3'
              }`}
            >
              {resultsPresentation.items.map(({ metric, label }) => (
                <div
                  key={metric.id}
                  className="flex min-w-0 flex-col justify-between rounded-xl border border-border/60 bg-muted/40 p-2.5 text-left"
                >
                  <span className="truncate text-xs text-muted-foreground">
                    {label}
                  </span>
                  <span className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">
                    {formatTodayMetricText(metric)}
                  </span>
                </div>
              ))}
            </div>
            {resultsPresentation.commonPeriodText ? (
              <p role="note" className="text-[11px] leading-tight text-muted-foreground">
                {resultsPresentation.commonPeriodText}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              {view.results.state === 'loading'
                ? '성과를 확인하고 있어요.'
                : view.results.state === 'error'
                  ? '성과를 불러오지 못했어요. 다시 확인해 주세요.'
                  : view.results.state === 'stale'
                    ? '성과를 다시 확인해 주세요. 이전에 확인한 정보예요.'
                    : view.results.state === 'unknown' || view.results.data === null
                      ? '성과 정보를 아직 확인하지 못했어요.'
                      : '확인된 결과가 생기면 여기에 보여드려요.'}
            </p>
            {view.results.state === 'error' || view.results.state === 'stale' ? (
              <Button variant="outline" size="sm" onClick={onRefresh} className="w-fit min-h-11 text-xs">
                성과 다시 확인
              </Button>
            ) : null}
          </div>
        )}

        {/* 하단 성과 보기 링크 */}
        <div className="pt-0.5">
          <Link
            prefetch={false}
            href="/app/results"
            className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>성과 보기</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
