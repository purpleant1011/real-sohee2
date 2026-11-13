'use client'

import React, { useState } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { RotateCw, AlertCircle } from 'lucide-react'
import { useKakaoHistory } from '@/features/kakao/history/use-kakao-history'
import { KakaoStatusBadge } from '@/features/kakao/history/history-badge'
import { formatKstHistoryTime } from '@/features/kakao/history/history-list'
import {
  computeKakaoSummaryCounts,
  filterKakaoHistoryItems,
  KAKAO_FILTER_TABS,
  type KakaoFilterTab,
} from '@/features/kakao/history/kakao-center-summary'
import { cn } from '@/lib/utils'

export interface KakaoViewProps {
  workspaceId: string
}

export function KakaoView({ workspaceId }: KakaoViewProps) {
  const [activeTab, setActiveTab] = useState<KakaoFilterTab>('all')
  const { items, load, refresh } = useKakaoHistory({
    workspaceId,
    limit: 50,
  })

  const summary = computeKakaoSummaryCounts(items)
  const filteredItems = filterKakaoHistoryItems(items, activeTab)

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              카카오 안내 발송 센터
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              고객에게 보낸 예약 안내를 확인하는 곳이에요. 보내지 않은 안내는 이유가 함께 표시돼요.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={load === 'loading'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-border bg-card text-foreground hover:bg-muted transition-colors cursor-pointer self-start sm:self-auto disabled:opacity-50"
          >
            <RotateCw className={cn('w-3.5 h-3.5', load === 'loading' && 'animate-spin')} />
            새로고침
          </button>
        </div>

        {/* 상단 요약 카드 (비용/크레딧/잔액 숫자 금지) */}
        <section aria-label="발송 현황 요약" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-4 rounded-2xl border border-border bg-card space-y-1">
            <span className="text-xs font-medium text-muted-foreground">도착확인</span>
            <div data-testid="summary-delivered" className="text-2xl font-bold text-state-ok">
              {summary.delivered}
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-border bg-card space-y-1">
            <span className="text-xs font-medium text-muted-foreground">보냄</span>
            <div data-testid="summary-sent" className="text-2xl font-bold text-foreground">
              {summary.sent}
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-border bg-card space-y-1">
            <span className="text-xs font-medium text-muted-foreground">확인필요</span>
            <div data-testid="summary-needs-check" className="text-2xl font-bold text-state-warn">
              {summary.needsCheck}
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-border bg-card space-y-1">
            <span className="text-xs font-medium text-muted-foreground">보내지 않음</span>
            <div data-testid="summary-held" className="text-2xl font-bold text-zinc-500">
              {summary.held}
            </div>
          </div>
          <div className="p-4 rounded-2xl border border-border bg-card space-y-1 col-span-2 sm:col-span-1">
            <span className="text-xs font-medium text-muted-foreground">취소</span>
            <div data-testid="summary-cancelled" className="text-2xl font-bold text-zinc-400">
              {summary.cancelled}
            </div>
          </div>
        </section>

        {/* 상태 필터 탭 */}
        <div className="flex border-b border-border/80 gap-1" role="tablist" aria-label="발송 상태 필터">
          {KAKAO_FILTER_TABS.map((tab) => {
            const isSelected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px',
                  isSelected
                    ? 'border-primary text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 콘텐츠 영역: 로딩 / 오류 / 빈 상태 / 목록 */}
        {load === 'loading' && (
          <div
            role="status"
            aria-label="발송내역을 불러오는 중입니다"
            className="space-y-3"
          >
            {[1, 2, 3].map((key) => (
              <div
                key={key}
                className="p-4 rounded-2xl border border-border bg-card space-y-2 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-32 bg-muted rounded" />
                  <div className="h-5 w-20 bg-muted rounded-full" />
                </div>
                <div className="h-3 w-40 bg-muted/70 rounded" />
              </div>
            ))}
            <span className="sr-only">발송내역을 불러오는 중입니다</span>
          </div>
        )}

        {load === 'error' && (
          <div
            role="alert"
            className="p-8 rounded-2xl border border-destructive/20 bg-destructive/5 text-center space-y-3"
          >
            <div className="inline-flex size-10 rounded-full bg-destructive/10 items-center justify-center text-destructive mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-destructive">
              발송내역을 불러오지 못했어요
            </p>
            <p className="text-xs text-muted-foreground">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </p>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
            >
              다시 시도
            </button>
          </div>
        )}

        {load === 'ready' && items.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground border border-dashed border-border rounded-2xl bg-card/40">
            아직 보낸 안내가 없어요
          </div>
        )}

        {load === 'ready' && items.length > 0 && filteredItems.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground border border-dashed border-border rounded-2xl bg-card/40">
            해당하는 안내가 없어요
          </div>
        )}

        {load === 'ready' && filteredItems.length > 0 && (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-card overflow-hidden">
            {filteredItems.map((item) => {
              const timeText = formatKstHistoryTime(item.updatedAt || item.dueAt)
              return (
                <li key={item.id} className="p-4 space-y-1.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {item.eventLabel}
                    </span>
                    <KakaoStatusBadge item={item} />
                  </div>

                  {timeText && (
                    <div className="text-xs text-muted-foreground font-mono">
                      {timeText}
                    </div>
                  )}

                  {item.detailLabel && (
                    <p className="text-xs text-muted-foreground leading-relaxed pt-0.5">
                      {item.detailLabel}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </V088AppShell>
  )
}
