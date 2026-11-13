'use client'

import Link from 'next/link'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { DecisionPage, MobileDecision, Remote } from '@/features/mobile-decision/contracts'
import { mapChannelName } from '@/features/mobile-today/decision-hero'

export interface GroupedPcDecision {
  id: string
  kind: MobileDecision['kind']
  title: string
  targetLabel: string
  count: number
  itemIds: string[]
}

export function groupPcDecisions(items: readonly MobileDecision[]): GroupedPcDecision[] {
  const groups: GroupedPcDecision[] = []
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

      const uniqueLabels = Array.from(new Set(list.map((i) => mapChannelName(i.targetLabel)).filter(Boolean)))
      const targetLabel = uniqueLabels.join(' · ') || mapChannelName(item.targetLabel)

      groups.push({
        id: list[0].id,
        kind: item.kind,
        title,
        targetLabel: `${targetLabel} · 확인 대기`,
        count: list.length,
        itemIds: list.map((i) => i.id),
      })
    } else {
      groups.push({
        id: item.id,
        kind: item.kind,
        title: item.title,
        targetLabel: `${mapChannelName(item.targetLabel)} · 승인 필요`,
        count: 1,
        itemIds: [item.id],
      })
    }
  }

  return groups.slice(0, 5)
}

export function getDecisionItemHref(item: GroupedPcDecision): string {
  if (item.kind === 'comment_reply' || item.kind === 'dm_reply') {
    return `/app/engagement?item=${encodeURIComponent(item.id)}`
  }
  if (item.kind === 'post_publish') {
    return `/app/content?item=${encodeURIComponent(item.id)}`
  }
  return `/app/approvals?item=${encodeURIComponent(item.id)}`
}

export interface PcDecisionListProps {
  decisions: Remote<DecisionPage>
  onRefresh?: () => void
}

export function PcDecisionList({ decisions, onRefresh }: PcDecisionListProps) {
  const page = decisions.data
  const items = page?.items ?? []
  const grouped = groupPcDecisions(items)

  return (
    <Card className="rounded-2xl border border-border/80 bg-card shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-semibold text-foreground">
            지금 확인할 일
          </CardTitle>
          {grouped.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {grouped.reduce((acc, curr) => acc + curr.count, 0)}건
            </span>
          )}
        </div>
        <Link
          href="/app/approvals"
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          전체 보기
        </Link>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {decisions.state === 'loading' && (
          <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-4 text-center">
            <p className="text-sm text-muted-foreground">확인할 일을 불러오고 있어요</p>
          </div>
        )}

        {decisions.state === 'error' && (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 p-4 text-center">
            <p className="text-sm font-medium text-foreground">확인할 일을 불러오지 못했어요</p>
            <p className="text-xs text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh} className="mt-1">
                다시 확인하기
              </Button>
            )}
          </div>
        )}

        {decisions.state === 'ready' && grouped.length === 0 && (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 p-4 text-center">
            <CheckCircle2 className="size-6 text-state-ok" />
            <p className="text-sm font-medium text-foreground">지금 바로 확인할 일이 없어요</p>
            <p className="text-xs text-muted-foreground">모든 요청이 완료되었거나 대기 중인 항목이 없습니다.</p>
          </div>
        )}

        {grouped.length > 0 && (
          <ul className="divide-y divide-border/50">
            {grouped.map((item) => (
              <li key={item.id}>
                <Link
                  href={getDecisionItemHref(item)}
                  className="group flex items-center justify-between gap-3 py-3 px-2 rounded-lg transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.targetLabel}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
