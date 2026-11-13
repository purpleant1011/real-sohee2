'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { cn } from '@/lib/utils'
import {
  ShieldAlert,
  Sparkles,
  CreditCard,
  Target,
  Sliders,
  AlertCircle,
  Coins,
  ArrowUpRight,
  Radio
} from 'lucide-react'

export interface AdCampaignItem {
  id: string
  channel: 'instagram' | 'naver' | 'meta'
  title: string
  status: 'ACTIVE' | 'PAUSED' | 'PENDING'
  dailyBudgetKrw: number
  spentKrw: number
  roasPct: number | null
  targetAudience: string
}

interface AdsViewProps {
  workspaceId?: string
  isProviderConnected?: boolean
  campaigns?: AdCampaignItem[]
  actualAdSpendKrw?: number
  adSpendLimitKrw?: number
}

export function AdsView({
  workspaceId = 'ws-default',
  isProviderConnected = false,
  campaigns = [],
  actualAdSpendKrw,
  adSpendLimitKrw = 300000,
}: AdsViewProps) {
  // Mode: 소희 위임 vs 직접 운영
  const [delegationMode, setDelegationMode] = useState<'DELEGATED' | 'MANUAL'>('DELEGATED')

  // Guardrail settings
  const [dailyBudget, setDailyBudget] = useState(15000)
  const [monthlyBudget, setMonthlyBudget] = useState(adSpendLimitKrw)
  const [minRoas, setMinRoas] = useState(250)
  const [stopLossEnabled, setStopLossEnabled] = useState(true)
  const handleSaveGuardrails = (e: React.FormEvent) => {
    e.preventDefault()
  }

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="space-y-6 max-w-7xl mx-auto font-sans">
        {/* 1. 최상단: Sohee Live Workboard (실시간 자율 운영 관제) */}
        <SoheeLiveWorkboard workspaceId={workspaceId} />

        {/* 2. Header & Mode Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-black text-foreground tracking-tight">
                광고 센터
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                연결·권한 확인
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 break-keep">
              광고 계정 연결과 실행 권한, 실제 집행 근거를 각각 확인해 주세요. 이 화면에서 광고가 자동 실행되지는 않아요.
            </p>
          </div>

          {/* Mode Toggle: 소희 위임 vs 직접 운영 */}
          <div
            role="group"
            aria-label="운영 모드 선택"
            className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-1.5 p-1.5 rounded-2xl bg-muted/60 border border-border w-full sm:w-auto"
          >
            <button
              type="button"
              aria-pressed={delegationMode === 'DELEGATED'}
              onClick={() => setDelegationMode('DELEGATED')}
              className={`inline-flex min-h-11 items-center justify-center px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                delegationMode === 'DELEGATED'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                소희 위임 운영 미리보기
              </span>
            </button>
            <button
              type="button"
              aria-pressed={delegationMode === 'MANUAL'}
              onClick={() => setDelegationMode('MANUAL')}
              className={`inline-flex min-h-11 items-center justify-center px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                delegationMode === 'MANUAL'
                  ? 'bg-card text-foreground shadow-2xs border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Sliders className="w-3.5 h-3.5 shrink-0" />
                사장님 직접 승인
              </span>
            </button>
          </div>
        </div>

        {/* 3. 🌟 지표 엄격 분리 카드 (Metric Separation Invariant) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1) 플랜 권한 */}
          <div className="p-5 rounded-2xl bg-card border border-border shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-bold flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-primary" />
                1. 서비스 플랜 권한
              </span>
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded">
                구독 플랜
              </span>
            </div>
            <div className="text-xl font-extrabold text-foreground">
              광고 실행 권한 확인 필요
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              구독 플랜만으로 광고 실행이 허용되지는 않아요. 연결 계정·매체 권한·예산 승인 확인이 필요해요.
            </p>
          </div>

          {/* 2) 외부 광고비 */}
          <div className="p-5 rounded-2xl bg-card border border-border shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-bold flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-state-ok" />
                2. 외부 광고비 (KRW 실집행)
              </span>
              <span className="text-[10px] font-bold bg-state-ok-soft text-state-ok px-2 py-0.5 rounded">
                실제 광고비
              </span>
            </div>
            <div className={cn("text-xl font-extrabold text-state-ok", actualAdSpendKrw !== undefined && Number.isFinite(actualAdSpendKrw) && actualAdSpendKrw >= 0 && "font-mono")}>
              {actualAdSpendKrw !== undefined && Number.isFinite(actualAdSpendKrw) && actualAdSpendKrw >= 0 ? `₩${actualAdSpendKrw.toLocaleString()}` : '집행액 확인 필요'}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {isProviderConnected ? '공급자 계정에 직접 청구되는 실측 광고 집행비입니다.' : '광고 계정 연결 시 실제 집행액이 동기화됩니다.'}
            </p>
          </div>
        </div>

        {/* 4. Provider 연결 가드: CONNECT_REQUIRED */}
        {!isProviderConnected ? (
          <div className="p-8 rounded-3xl bg-card border border-dashed border-border shadow-xs text-center space-y-4">
            <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <AlertCircle className="size-6" />
            </div>
            <div className="max-w-md mx-auto space-y-1.5">
              <div className="flex items-center justify-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  광고 매체 연동이 필요합니다
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-bold">
                  연동 필요
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                광고 계정 연결을 확인하지 못했어요. 채널 연결 화면에서 계정과 매체 권한을 확인해 주세요. 연결만으로 광고가 자동 집행되지는 않아요.
              </p>
            </div>
            <div>
              <Link
                href="/app/settings/channels"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs transition-colors shadow-2xs"
              >
                광고 매체 계정 연결하기
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 오가닉 성과 기반 부스팅 제안 (실측 기반) */}
            <div className="p-6 rounded-3xl bg-gradient-to-r from-primary/90 via-state-wait/90 to-zinc-950 text-white shadow-lg space-y-4 border border-primary/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg bg-white/10 text-primary">
                    <Radio className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-bold text-primary">
                    오가닉 성과 기반 지능형 부스팅 탐색
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 font-mono font-bold">
                  ANALYZING
                </span>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base md:text-lg font-black leading-snug">
                  오가닉 전환 지표 실시간 감지 중
                </h3>
                <p className="text-xs text-primary/80 leading-relaxed max-w-3xl">
                  연동된 채널의 게시물 반응도(조회수, 저장수, 체류 시간)를 분석 중입니다. 신규 전환 잠재력이 입증된 콘텐츠가 발견되면 사장님께 최적의 예산과 예상 성과를 제안합니다.
                </p>
              </div>
            </div>

            {/* 5. 예산 가드레일 & 안전 규칙 폼 */}
            <div className="p-6 rounded-3xl bg-card border border-border shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-primary" />
                  <span>광고 예산 가드레일 (Budget Guardrails & Stop-Loss)</span>
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                예산 설정은 아직 서버에 저장되지 않아요. 아래 값은 검토용이며 실제 광고 한도나 자동 중지 규칙으로 적용되지 않아요.
              </p>

              <form onSubmit={handleSaveGuardrails} className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    일일 지출 한도 (KRW)
                  </label>
                  <input
                    type="number"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-background border border-border text-xs focus:outline-none focus:border-primary/30 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    월간 총 지출 한도 (KRW)
                  </label>
                  <input
                    type="number"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-background border border-border text-xs focus:outline-none focus:border-primary/30 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    목표 ROAS 마지노선 (%)
                  </label>
                  <input
                    type="number"
                    value={minRoas}
                    onChange={(e) => setMinRoas(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-background border border-border text-xs focus:outline-none focus:border-primary/30 font-mono font-bold"
                  />
                </div>

                <div className="sm:col-span-3 flex items-center justify-between pt-2 border-t border-border">
                  <label className="flex items-center gap-2 text-xs text-foreground font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stopLossEnabled}
                      onChange={(e) => setStopLossEnabled(e.target.checked)}
                      className="rounded text-primary focus:ring-primary/30"
                    />
                    <span>ROAS 마지노선 미달 시 소희가 이상 징후 알림을 보냅니다.</span>
                  </label>

                  <button
                    type="submit"
                    disabled
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs cursor-pointer transition-colors shadow-2xs"
                  >
                    가드레일 저장
                  </button>
                </div>
              </form>
            </div>

            {/* 6. 활성 광고 캠페인 리스트 (실측 기반) */}
            <div className="p-6 rounded-3xl bg-card border border-border shadow-xs space-y-4">
              <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <span>현재 집행 중인 광고 캠페인 ({campaigns.length}건)</span>
              </h3>

              {campaigns.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-2xl space-y-1">
                  <p className="font-semibold text-foreground">집행 중인 실시간 캠페인이 없습니다</p>
                  <p className="text-[11px]">오가닉 콘텐츠 반응이 감지되면 소희가 부스팅 제안을 생성합니다.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((camp) => (
                    <div
                      key={camp.id}
                      className="p-4 rounded-2xl bg-muted/40 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-foreground">{camp.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            camp.status === 'ACTIVE'
                              ? 'bg-state-ok-soft text-state-ok'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {camp.status === 'ACTIVE' ? '집행 중' : '일시정지'}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                          타깃: {camp.targetAudience} · 일 ₩{camp.dailyBudgetKrw.toLocaleString()} 지출 한도
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div>
                          <span className="text-[10px] text-muted-foreground block">누적 지출</span>
                          <span className="font-extrabold font-mono text-foreground">
                            ₩{camp.spentKrw.toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground block">현재 ROAS</span>
                          <span className="font-extrabold font-mono text-state-ok">
                            {camp.roasPct !== null ? `${camp.roasPct}%` : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </V088AppShell>
  )
}

