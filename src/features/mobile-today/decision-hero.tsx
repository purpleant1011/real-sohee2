'use client'

import Link from 'next/link'
import { ChevronRight, Clock3, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MobileDecision, MobileHomeDto } from '../mobile-decision/contracts'
import { confirmedEmpty, selectDecisions } from '../mobile-decision/selectors'
import { rememberDecisionClick } from '../mobile-decision/decision-return'

const KIND_LABELS: Record<MobileDecision['kind'], string> = {
  dm_reply: '메시지',
  comment_reply: '댓글',
  post_publish: '콘텐츠',
  proposal: '소희 제안',
}

export function mapChannelName(raw: string): string {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'sohee.ai' || lower === 'instagram') return '인스타그램'
  if (lower === 'threads') return '스레드'
  if (lower === 'naver_blog' || lower === 'naver-blog') return '네이버 블로그'
  if (lower === 'naver_place' || lower === 'naver-place') return '네이버 플레이스'
  if (lower === 'daangn' || lower === 'daangn_business' || lower === 'daangn-business') return '당근'
  return trimmed
}

export interface GroupedDecisionItem {
  id: string
  kind: MobileDecision['kind']
  title: string
  targetLabel: string
  count: number
  itemIds: string[]
}

export function groupDecisions(items: readonly MobileDecision[]): GroupedDecisionItem[] {
  const groups: GroupedDecisionItem[] = []
  const byKind = new Map<MobileDecision['kind'], MobileDecision[]>()

  for (const item of items) {
    const list = byKind.get(item.kind) ?? []
    list.push(item)
    byKind.set(item.kind, list)
  }

  const processedKinds = new Set<MobileDecision['kind']>()
  for (const item of items) {
    if (processedKinds.has(item.kind)) continue
    processedKinds.add(item.kind)
    const list = byKind.get(item.kind) ?? [item]
    if (list.length >= 2) {
      let title: string
      if (item.kind === 'comment_reply') title = `고객 댓글 ${list.length}건`
      else if (item.kind === 'dm_reply') title = `고객 메시지 ${list.length}건`
      else if (item.kind === 'post_publish') title = `콘텐츠 검토 ${list.length}건`
      else if (item.kind === 'proposal') title = `소희 제안 ${list.length}건`
      else title = `${item.title} ${list.length}건`

      const uniqueLabels = Array.from(new Set(list.map(i => mapChannelName(i.targetLabel)).filter(Boolean)))
      const targetLabel = uniqueLabels.join(' · ') || mapChannelName(item.targetLabel)

      groups.push({
        id: list[0].id,
        kind: item.kind,
        title,
        targetLabel,
        count: list.length,
        itemIds: list.map(i => i.id),
      })
    } else {
      groups.push({
        id: item.id,
        kind: item.kind,
        title: item.title,
        targetLabel: mapChannelName(item.targetLabel),
        count: 1,
        itemIds: [item.id],
      })
    }
  }

  return groups.slice(0, 3)
}

export interface DecisionHeroProps {
  view: Pick<MobileHomeDto, 'decisions' | 'workspaceId'>
  onRefresh: () => void
}

/**
 * 오늘 화면 최상단 의사결정 히어로 카드.
 * 지금 확인해야 할 일을 최대 3개까지 보여주고, 10초 안에 검토로 연결한다.
 */
export function DecisionHero({ view, onRefresh }: DecisionHeroProps) {
  const { decisions } = view
  const page = decisions.data
  const rawItems = selectDecisions(page?.items ?? [])
  const items = groupDecisions(rawItems)
  const isConfirmedEmpty = confirmedEmpty(decisions)
  const hasTotal = decisions.state === 'ready' && page?.complete === true && typeof page?.total === 'number' && Number.isFinite(page.total)
  const showPartialNotice = decisions.state === 'ready' && page?.complete === false

  return (
    <Card className="gap-4 rounded-2xl border-border/80 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-0">
        <div className="flex items-center gap-2">
          <CardTitle role="heading" aria-level={3} className="text-base font-semibold tracking-tight text-foreground">
            지금 확인할 일
          </CardTitle>
          {hasTotal ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-semibold">
              {page.total}
            </Badge>
          ) : null}
        </div>
        {decisions.state === 'ready' || decisions.state === 'stale' ? (
          <Button variant="ghost" size="sm" asChild className="min-h-11 gap-0.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <Link prefetch={false} href="/app/approvals">
              모두 확인
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        {decisions.state === 'error' && (
          <div role="status" className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-4">
            <p className="text-sm font-semibold text-foreground">
              다음 할 일을 확인하지 못했어요
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              일시적인 연결 문제일 수 있어요. 할 일이 없는 것은 아니니 다시 확인해 보세요.
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="min-h-11 gap-1.5 text-xs font-medium"
              >
                <RefreshCw aria-hidden="true" />
                다시 확인
              </Button>
            </div>
          </div>
        )}

        {decisions.state === 'loading' && (
          <div role="status" className="flex flex-col gap-1 rounded-xl border border-dashed border-border/80 p-4">
            <p className="text-sm font-medium text-foreground">
              다음 할 일을 확인하고 있어요
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              확인이 끝날 때까지 완료로 표시하지 않아요.
            </p>
          </div>
        )}

        {decisions.state === 'unknown' && (
          <div role="status" className="flex flex-col gap-1 rounded-xl border border-dashed border-border/80 p-4">
            <p className="text-sm font-medium text-foreground">
              다음 할 일 연결을 확인하고 있어요
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              확인되지 않은 항목은 완료로 표시하지 않아요.
            </p>
          </div>
        )}

        {isConfirmedEmpty && (
          <div className="flex flex-col gap-1 py-1">
            <p className="text-sm font-medium text-foreground">
              지금 확인하실 일은 없어요
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              새 소식을 맡기거나 기존 작업을 살펴보세요.
            </p>
          </div>
        )}

        {decisions.state === 'stale' && (
          <p role="status" className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground [&>svg]:size-3.5">
            <Clock3 aria-hidden="true" />
            마지막 확인 이후 바뀌었을 수 있어요
          </p>
        )}

        {items.length > 0 && (
          <div className="flex flex-col divide-y divide-border/60">
            {items.map((item) => (
              <Link
                key={item.id}
                id={`mobile-decision-${item.id}`}
                onClick={event => rememberDecisionClick(event, view.workspaceId, item.id)}
                prefetch={false}
                href={`/app/approvals?item=${encodeURIComponent(item.id)}`}
                className="group flex min-h-12 items-center justify-between gap-3 py-3 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                    {item.title}
                  </span>
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-medium">
                      {KIND_LABELS[item.kind] ?? item.kind}
                    </Badge>
                    <span className="truncate">
                      {item.targetLabel}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 [&>svg]:size-4">
                  <ChevronRight aria-hidden="true" />
                </span>
              </Link>
            ))}

            {showPartialNotice && (
              <p className="pt-2 text-xs text-muted-foreground">
                확인된 항목만 보여드려요
              </p>
            )}
          </div>
        )}

        {showPartialNotice && items.length === 0 && (
          <div className="flex flex-col gap-1 py-1">
            <p className="text-xs text-muted-foreground">
              확인된 항목만 보여드려요
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
