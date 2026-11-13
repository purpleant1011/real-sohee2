'use client'

import React, { useState, useEffect } from 'react'
import { 
  Clock, 
  Coins, 
  Sparkles, 
  TrendingUp, 
  ShieldCheck, 
  CheckCircle2, 
  Layers, 
  Activity, 
  ArrowRight,
  RefreshCw,
  ChevronDown,
  Info
} from 'lucide-react'
import { 
  CreditEconomyEngine, 
  PLAN_CONFIGS, 
  type DailyOperatingPlan, 
  type RoutineBlock,
  type ActivityPortfolioMix 
} from '@/features/marketing-agent/engine/credit-economy'

export function DailyRoutineAndCreditStrip({
  workspaceId = 'ws-default'
}: {
  workspaceId?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [account] = useState({
    workspaceId,
    planId: 'PLAN_150K' as const,
    weeklyCapacitySC: 15000,
    refillRateSCPerSecond: 15000 / (7 * 24 * 3600),
    balanceSC: 12450,
    reservedSC: 420,
    lastAccruedAt: 1788150000000,
    status: 'ACTIVE' as const
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const plan = CreditEconomyEngine.generateDailyOperatingPlan(account)
  const [selectedBlockId, setSelectedBlockId] = useState<string>(plan.routineBlocks[2].id)
  const selectedBlock = plan.routineBlocks.find(b => b.id === selectedBlockId) || plan.routineBlocks[0]

  return (
    <div className="space-y-4">
      {/* Top 3-Card Dashboard Strip: 24h Rolling Forecast + Operating Mode + Activity Mix */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left: 24h Credit Rolling Forecast Card (4 cols) */}
        <div className="md:col-span-4 p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                <Coins className="w-4 h-4" />
                <span>소희 업무 크레딧 & 24h 가동 현황</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-md font-bold bg-state-ok-soft text-state-ok border border-state-ok/30">
                안심 자동 가동 중
              </span>
            </div>

            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-extrabold text-[var(--v088-ink)] font-mono" suppressHydrationWarning>
                {Math.floor(plan.startingAvailableSC).toLocaleString()}
              </span>
              <span className="text-xs text-[var(--v088-muted)] font-semibold">
                / {account.weeklyCapacitySC.toLocaleString()} 크레딧 가용
              </span>
            </div>

            {/* Rolling 24h Forecast Range */}
            <div className="mt-3 p-3 rounded-xl bg-[var(--v088-surface-subtle)] space-y-1.5 text-xs text-[var(--v088-ink)]">
              <div className="flex justify-between items-center">
                <span className="text-[var(--v088-muted)]">24h 예상 소비:</span>
                <span className="font-mono font-bold text-foreground dark:text-primary">
                  {plan.plannedSCLow} ~ {plan.plannedSCHigh} 크레딧 (예상: {plan.plannedSCExpected} 크레딧)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--v088-muted)]">24h 지속 충전:</span>
                <span className="font-mono font-bold text-state-ok">
                  +{plan.expectedRefillSC24h.toLocaleString()} 크레딧
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-[var(--v088-border)]">
                <span className="text-[var(--v088-muted)]">24h 후 예상 잔액:</span>
                <span className="font-mono font-bold text-[var(--v088-ink)]">
                  {plan.projectedEndBalanceExpected.toLocaleString()} 크레딧
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--v088-muted)]">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-state-ok" />
              예측 신뢰도: {Math.round(plan.forecastConfidence * 100)}%
            </span>
            <span className="font-mono" suppressHydrationWarning>
              재예측: 16:00
            </span>
          </div>
        </div>

        {/* Center: 6 Marketing Activity Mix Bar (8 cols) */}
        <div className="md:col-span-8 p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--v088-ink)]">
                <Activity className="w-4 h-4 text-primary" />
                <span>오늘의 마케팅 활동 믹스 (Activity Portfolio Budget)</span>
              </div>
              <span className="text-[11px] text-[var(--v088-muted)]">
                특정 작업 쏠림 방지 및 6대 직무 분배
              </span>
            </div>

            {/* Visual Multi-Color Stacked Bar */}
            <div className="h-3 rounded-full overflow-hidden flex gap-0.5 bg-neutral-100 dark:bg-neutral-800 my-2.5">
              {plan.portfolioMix.map(item => (
                <div
                  key={item.category}
                  style={{ width: `${item.sharePercentage}%` }}
                  title={`${item.name}: ${item.sharePercentage}% (${item.plannedSC} 크레딧)`}
                  className={`h-full transition-all ${
                    item.category === 'STRATEGY_MARKET'
                      ? 'bg-state-wait'
                      : item.category === 'CONTENT_DISTRIBUTION'
                      ? 'bg-primary'
                      : item.category === 'CUSTOMER_CONVERSION_CRM'
                      ? 'bg-state-ok'
                      : item.category === 'REPUTATION_LOCAL'
                      ? 'bg-state-warn'
                      : item.category === 'EXPERIMENT_LEARNING'
                      ? 'bg-primary'
                      : 'bg-state-wait'
                  }`}
                />
              ))}
            </div>

            {/* 6 Category Pills Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {plan.portfolioMix.map(item => (
                <div
                  key={item.category}
                  className="p-2 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        item.category === 'STRATEGY_MARKET'
                          ? 'bg-state-wait'
                          : item.category === 'CONTENT_DISTRIBUTION'
                          ? 'bg-primary'
                          : item.category === 'CUSTOMER_CONVERSION_CRM'
                          ? 'bg-state-ok'
                          : item.category === 'REPUTATION_LOCAL'
                          ? 'bg-state-warn'
                          : item.category === 'EXPERIMENT_LEARNING'
                          ? 'bg-primary'
                          : 'bg-state-wait'
                      }`}
                    />
                    <span className="font-semibold text-[var(--v088-ink)] text-[11px] truncate">
                      {item.name}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-foreground dark:text-primary">
                    {item.sharePercentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-[var(--v088-muted)] mt-2.5 flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>소희의 판단: {plan.portfolioMix[1].dominanceReason}</span>
          </p>
        </div>
      </div>

      {/* Routine Timeline Table (Scheduled vs Event-Driven Routine Blocks) */}
      <div className="p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--v088-border)]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm text-[var(--v088-ink)]">
              오늘 소희는 이렇게 일합니다 (24시간 마케팅 루틴 계획표)
            </h3>
          </div>
          <span className="text-xs text-[var(--v088-muted)]">
            각 루틴 블록을 클릭하여 세부 작업과 실시간 크레딧 소비 내역을 확인하세요
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Routine Blocks List (7 cols) */}
          <div className="lg:col-span-7 space-y-2.5">
            {plan.routineBlocks.map((block) => {
              const isSelected = block.id === selectedBlockId
              return (
                <div
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-primary bg-primary/40 shadow-xs ring-1 ring-primary/20'
                      : 'border-[var(--v088-border)] bg-[var(--v088-surface)] hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-mono font-bold text-primary shrink-0 w-24">
                      {block.window}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-[var(--v088-ink)]">
                        {block.purpose}
                      </h4>
                      <span className="text-[11px] text-[var(--v088-muted)] block mt-0.5">
                        담당: {block.marketingRole}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--v088-surface-subtle)] text-[var(--v088-ink)]">
                      {block.actualSC ? `${block.actualSC} 크레딧` : `예상 ${block.expectedSCExpected} 크레딧`}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        block.status === 'COMPLETED'
                          ? 'bg-state-ok-soft text-state-ok'
                          : block.status === 'RUNNING'
                          ? 'bg-primary text-white animate-pulse'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      {block.status === 'COMPLETED' ? '완료' : block.status === 'RUNNING' ? '진행 중' : '대기'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right: Selected Routine Block Drill-down (5 cols) */}
          <div className="lg:col-span-5 p-4 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-[var(--v088-border)] mb-3">
                <span className="text-xs font-mono font-bold text-primary">
                  {selectedBlock.window} ({selectedBlock.triggerType === 'SCHEDULED' ? '정기 스케줄' : '실시간 이벤트 감지'})
                </span>
                <span className="text-[11px] font-semibold text-[var(--v088-muted)]">
                  {selectedBlock.category}
                </span>
              </div>

              <h4 className="font-bold text-sm text-[var(--v088-ink)] mb-1">
                {selectedBlock.purpose}
              </h4>
              <p className="text-xs text-[var(--v088-muted)] mb-3">
                역할: <span className="text-[var(--v088-ink)] font-semibold">{selectedBlock.marketingRole}</span>
              </p>

              <div className="p-3 rounded-lg bg-[var(--v088-surface)] border border-[var(--v088-border)] text-xs space-y-1.5 mb-3">
                <div className="flex justify-between">
                  <span className="text-[var(--v088-muted)]">예상 소비 범위:</span>
                  <span className="font-mono font-bold text-[var(--v088-ink)]">
                    {selectedBlock.expectedSCLow} ~ {selectedBlock.expectedSCHigh} 크레딧
                  </span>
                </div>
                {selectedBlock.actualSC && (
                  <div className="flex justify-between">
                    <span className="text-[var(--v088-muted)]">실제 사용 크레딧:</span>
                    <span className="font-mono font-bold text-state-ok">
                      {selectedBlock.actualSC} 크레딧
                    </span>
                  </div>
                )}
              </div>

              <div>
                <span className="text-[11px] font-bold text-[var(--v088-muted)] block mb-1">
                  소희의 실행 판단 이유 (Why):
                </span>
                <p className="text-xs text-[var(--v088-ink)] leading-relaxed p-2.5 rounded-lg bg-primary/60 border border-primary/15">
                  {selectedBlock.why}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--v088-border)] mt-3 flex items-center justify-between text-xs">
              <span className="text-[11px] text-[var(--v088-muted)]">
                사용자 PC가 꺼져 있어도 서버에서 자율 실행됩니다
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
