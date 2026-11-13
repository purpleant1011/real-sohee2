'use client'

import React, { useState } from 'react'
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

export interface MobileKakaoViewProps {
  workspaceId: string
  className?: string
}

export function MobileKakaoView({ workspaceId, className }: MobileKakaoViewProps) {
  const [activeTab, setActiveTab] = useState<KakaoFilterTab>('all')
  const { items, load, refresh } = useKakaoHistory({
    workspaceId,
    limit: 50,
  })

  const summary = computeKakaoSummaryCounts(items)
  const filteredItems = filterKakaoHistoryItems(items, activeTab)

  return (
    <div className={cn('w-full max-w-[390px] mx-auto space-y-4 px-4 pb-8', className)}>
      {/* 헤더 & 도움말 한 줄 */}
      <div className="space-y-1.5 pt-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            카카오 안내 내역
          </h1>
          <button
            type="button"
            onClick={refresh}
            disabled={load === 'loading'}
            aria-label="새로고침"
            className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-card text-foreground hover:bg-muted active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
          >
            <RotateCw className={cn('size-4', load === 'loading' && 'animate-spin')} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          고객에게 보낸 예약 안내를 확인하는 곳이에요. 보내지 않은 안내는 이유가 함께 표시돼요.
        </p>
      </div>

      {/* 상단 요약 (390px 그리드, 비용/크레딧/잔액 숫자 금지) */}
      <section aria-label="발송 요약" className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-2xl border border-border/80 bg-card/80 space-y-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">도착확인</span>
          <div data-testid="mobile-summary-delivered" className="text-lg font-bold text-state-ok">
            {summary.delivered}
          </div>
        </div>
        <div className="p-3 rounded-2xl border border-border/80 bg-card/80 space-y-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">보냄</span>
          <div data-testid="mobile-summary-sent" className="text-lg font-bold text-foreground">
            {summary.sent}
          </div>
        </div>
        <div className="p-3 rounded-2xl border border-border/80 bg-card/80 space-y-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">확인필요</span>
          <div data-testid="mobile-summary-needs-check" className="text-lg font-bold text-state-warn">
            {summary.needsCheck}
          </div>
        </div>
        <div className="p-3 rounded-2xl border border-border/80 bg-card/80 space-y-0.5 col-span-1">
          <span className="text-[11px] font-medium text-muted-foreground">보내지 않음</span>
          <div data-testid="mobile-summary-held" className="text-lg font-bold text-zinc-500">
            {summary.held}
          </div>
        </div>
        <div className="p-3 rounded-2xl border border-border/80 bg-card/80 space-y-0.5 col-span-2">
          <span className="text-[11px] font-medium text-muted-foreground">취소</span>
          <div data-testid="mobile-summary-cancelled" className="text-lg font-bold text-zinc-400">
            {summary.cancelled}
          </div>
        </div>
      </section>

      {/* 필터 칩 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none" role="group" aria-label="상태 필터 칩">
        {KAKAO_FILTER_TABS.map((tab) => {
          const isSelected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted'
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* 로딩 / 오류 / 빈 상태 / 목록 카드 */}
      {load === 'loading' && (
        <div role="status" aria-label="발송내역을 불러오는 중입니다" className="space-y-2.5">
          {[1, 2, 3].map((key) => (
            <div key={key} className="p-3.5 rounded-2xl border border-border bg-card space-y-2 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-4 w-28 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded-full" />
              </div>
              <div className="h-3 w-36 bg-muted/70 rounded" />
            </div>
          ))}
          <span className="sr-only">발송내역을 불러오는 중입니다</span>
        </div>
      )}

      {load === 'error' && (
        <div role="alert" className="p-6 rounded-2xl border border-destructive/20 bg-destructive/5 text-center space-y-2.5">
          <div className="inline-flex size-9 rounded-full bg-destructive/10 items-center justify-center text-destructive mx-auto">
            <AlertCircle className="size-4" />
          </div>
          <p className="text-xs font-semibold text-destructive">
            발송내역을 불러오지 못했어요
          </p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      )}

      {load === 'ready' && items.length === 0 && (
        <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-2xl bg-card/50">
          아직 보낸 안내가 없어요
        </div>
      )}

      {load === 'ready' && items.length > 0 && filteredItems.length === 0 && (
        <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-2xl bg-card/50">
          해당하는 안내가 없어요
        </div>
      )}

      {load === 'ready' && filteredItems.length > 0 && (
        <ul className="space-y-2.5">
          {filteredItems.map((item) => {
            const timeText = formatKstHistoryTime(item.updatedAt || item.dueAt)
            return (
              <li
                key={item.id}
                className="p-3.5 rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(20,16,40,0.03)] space-y-1.5 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-foreground truncate">
                    {item.eventLabel}
                  </span>
                  <KakaoStatusBadge item={item} />
                </div>

                {timeText && (
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {timeText}
                  </div>
                )}

                {item.detailLabel && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                    {item.detailLabel}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
