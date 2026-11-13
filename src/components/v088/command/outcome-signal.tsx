'use client'

import React from 'react'
import { TrendingUp, CalendarCheck, CheckCircle2, ShieldCheck, HelpCircle } from 'lucide-react'

export interface OutcomeSignalProps {
  potentialRevenue?: number
  bookedRevenue?: number
  realizedRevenue?: number
  attributionSummary?: {
    directCount: number
    assistedCount: number
    unclearCount: number
  }
}

export function OutcomeSignal({
  potentialRevenue = 850000,
  bookedRevenue = 540000,
  realizedRevenue = 360000,
  attributionSummary = {
    directCount: 4,
    assistedCount: 2,
    unclearCount: 1
  }
}: OutcomeSignalProps) {
  const formatWon = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(num) + '원'
  }

  return (
    <div className="p-5 md:p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-state-ok" />
          <h3 className="font-bold text-base tracking-tight">실시간 성과 원장</h3>
        </div>
        <span className="text-[11px] font-medium text-[var(--v088-muted)]">
          실제 예약 및 결제 원장 기반
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {/* Potential Revenue */}
        <div className="p-4 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border-subtle)]">
          <span className="text-xs font-semibold text-[var(--v088-muted)] block mb-1">
            잠재 예상 매출
          </span>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-[var(--v088-ink)]">
            {formatWon(potentialRevenue)}
          </div>
          <span className="text-[10px] text-[var(--v088-muted)] mt-0.5 block">
            진행 중인 프로모션 및 미답변 문의
          </span>
        </div>

        {/* Booked Revenue */}
        <div className="p-4 rounded-xl bg-primary/60 border border-primary/70">
          <span className="text-xs font-semibold text-foreground dark:text-primary block mb-1">
            확정된 예약 매출
          </span>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-foreground dark:text-primary">
            {formatWon(bookedRevenue)}
          </div>
          <span className="text-[10px] text-primary/80 mt-0.5 block">
            이번 주 방문 예정 예약 슬롯
          </span>
        </div>

        {/* Realized Revenue */}
        <div className="p-4 rounded-xl bg-state-ok/60 border border-state-ok/70">
          <span className="text-xs font-semibold text-state-ok block mb-1">
            실제 결제 매출
          </span>
          <div className="text-lg md:text-xl font-bold font-mono tracking-tight text-state-ok">
            {formatWon(realizedRevenue)}
          </div>
          <span className="text-[10px] text-state-ok/70 mt-0.5 block">
            서비스 완료 및 결제 확인된 매출
          </span>
        </div>
      </div>

      {/* Attribution Trace Summary */}
      <div className="p-3 rounded-xl bg-[var(--v088-surface-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[var(--v088-muted)]">마케팅 기여도 (Attribution):</span>
        <div className="flex items-center gap-3 font-semibold">
          <span className="text-state-ok">
            직접 기여: {attributionSummary.directCount}건
          </span>
          <span className="text-primary">
            간접 기여: {attributionSummary.assistedCount}건
          </span>
          <span className="text-[var(--v088-muted)]">
            자연 유입: {attributionSummary.unclearCount}건
          </span>
        </div>
      </div>
    </div>
  )
}
