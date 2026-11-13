'use client'

import React, { useState } from 'react'
import { 
  Coins, 
  Sparkles, 
  ShieldCheck, 
  Cpu, 
  Check, 
  Zap, 
  TrendingUp, 
  AlertCircle, 
  Sliders,
  Activity,
  Layers,
  CheckCircle2,
  PlusCircle,
  FileText,
  MessageSquare,
  Share2
} from 'lucide-react'
import { 
  PLAN_CONFIGS, 
  type CreditPlanId 
} from '@/features/marketing-agent/engine/credit-economy'
import { useCreditBalance } from '@/hooks/use-credit-balance'

export function CreditsAndIntelligenceView() {
  const { capacity, balance, usedCredits, remainingPercentage, usagePercentage, rechargeCredits } = useCreditBalance()
  const [currentPlanId, setCurrentPlanId] = useState<CreditPlanId>('PLAN_150K')
  const [isConserveMode, setIsConserveMode] = useState(false)
  const [intelligenceMode, setIntelligenceMode] = useState<'SMART_AUTO' | 'MAX_QUALITY' | 'FAST_SIMPLE'>('SMART_AUTO')
  const [showRechargeModal, setShowRechargeModal] = useState(false)

  const currentPlan = PLAN_CONFIGS[currentPlanId]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Coins className="w-5 h-5 text-primary" />
            <span className="text-xs font-bold text-primary uppercase tracking-wider">
              소희 플랜 & 크레딧 관리
            </span>
          </div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            소희 업무 크레딧 & AI 플랜
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            소희가 매장의 콘텐츠 제작, 고객 예약 응대, 자동 포스팅 등 다양한 마케팅 업무를 수행할 때 사용하는 업무 크레딧 및 플랜입니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-3 py-1.5 rounded-xl font-bold bg-state-ok-soft text-state-ok border border-state-ok/30 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            소희 AI 엔진 정상 가동 중 (안전 운영)
          </span>
        </div>
      </div>

      {/* 4 Plans Pricing & Capacity Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.values(PLAN_CONFIGS).map((plan) => {
          const isSelected = plan.planId === currentPlanId
          return (
            <div
              key={plan.planId}
              onClick={() => setCurrentPlanId(plan.planId)}
              className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'border-primary bg-primary/40 shadow-sm ring-2 ring-primary/20'
                  : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#121215] hover:border-primary/40 dark:hover:border-primary'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-primary uppercase">
                    {plan.name}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-white">
                      현재 이용 중
                    </span>
                  )}
                </div>

                <div className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50 mb-3">
                  {plan.priceKRW === 0 ? '무료' : `₩${plan.priceKRW.toLocaleString()} / 월`}
                </div>

                <div className="space-y-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-500 dark:text-zinc-400">주간 기본 크레딧:</span>
                    <span className="font-mono font-bold">{plan.weeklyCapacitySC.toLocaleString()} SC</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-500 dark:text-zinc-400">1회 생성 한도:</span>
                    <span className="font-mono">{plan.maxAutonomousSCPerMission} SC</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500 dark:text-zinc-400">일일 업무 예산:</span>
                    <span className="font-mono">{plan.maxExperimentSCPerDay} SC</span>
                  </div>
                </div>
              </div>

              <button
                className={`w-full mt-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-primary/10 dark:hover:bg-primary/40'
                }`}
              >
                {isSelected ? '선택됨' : '플랜 변경'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Autonomous Safe Governor & Model Router Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Safe Credit Governor */}
        <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
                크레딧 안심 소비 보호
              </h3>
            </div>
            <span className="text-xs text-zinc-400">과소비 방지 안심 가드</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900">
              <div>
                <span className="font-bold text-zinc-900 dark:text-zinc-100 block">크레딧 절약 모드 (Conserve Mode)</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  잔여 크레딧 30% 이하 시 불필요한 과소비를 차단하고 핵심 문의 응대에 집중합니다.
                </span>
              </div>
              <button
                onClick={() => setIsConserveMode(!isConserveMode)}
                className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ml-3 ${
                  isConserveMode ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                    isConserveMode ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">시간당 최대 사용 한도:</span>
                <span className="font-mono font-bold text-primary">
                  {currentPlan.maxAutonomousSCPerHour} SC / h
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">주간 벤치마크 학습 한도:</span>
                <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">
                  {currentPlan.maxDiscoverySCPerWeek} SC / week
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: AI Brain Performance Mode */}
        <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
                소희 두뇌 엔진 작업 모드
              </h3>
            </div>
            <span className="text-xs text-zinc-400">글쓰기 & 응대 스타일</span>
          </div>

          <div className="space-y-2.5">
            {[
              {
                id: 'SMART_AUTO' as const,
                title: '스마트 자동 최적화 모드 (권장)',
                desc: '업무 중요도와 채널 특성에 맞춰 심층 글쓰기와 빠른 응대를 똑똑하게 자동 조율합니다.'
              },
              {
                id: 'MAX_QUALITY' as const,
                title: '최고 품질 집중 모드 (Max Quality)',
                desc: '네이버 블로그 심층 칼럼 등 고난도 콘텐츠 작성 시 최고 수준의 감성과 전문성을 발휘합니다.'
              },
              {
                id: 'FAST_SIMPLE' as const,
                title: '초고속 일상 모드 (Fast & Simple)',
                desc: '인스타그램 피드, 일상 공유, 빠른 DM 답변 등 간결하고 즉각적인 소통 위주로 빠르게 처리합니다.'
              }
            ].map((option) => (
              <div
                key={option.id}
                onClick={() => setIntelligenceMode(option.id)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  intelligenceMode === option.id
                    ? 'border-primary bg-primary/40'
                    : 'border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    {option.title}
                  </span>
                  {intelligenceMode === option.id && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {option.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Customer-Friendly Monthly Usage & Activity Breakdown */}
      <div className="p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
              이번 달 크레딧 사용 현황
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              소희가 이번 달 수행한 주요 마케팅 활동별 크레딧 차감 내역입니다.
            </p>
          </div>
          <button
            onClick={() => setShowRechargeModal(true)}
            className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>크레딧 추가 충전</span>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-500 dark:text-zinc-400 font-medium">
              총 {capacity.toLocaleString()} SC 중 <strong className="text-primary font-bold">{usedCredits.toLocaleString()} SC</strong> 사용
            </span>
            <span className="text-zinc-700 dark:text-zinc-300 font-mono font-bold" suppressHydrationWarning>
              잔여 {balance.toLocaleString()} SC ({remainingPercentage}%)
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${usagePercentage}%` }} />
          </div>
        </div>

        {/* Activity Breakdown Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2 text-zinc-500">
              <FileText className="w-4 h-4 text-state-ok" />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">블로그 칼럼 작성</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-zinc-500">발행 편수 측정 전</span>
              <span className="text-xs font-mono font-bold text-primary">1,450 SC</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2 text-zinc-500">
              <Share2 className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">인스타 & 스레드 피드</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-zinc-500">발행 건수 측정 전</span>
              <span className="text-xs font-mono font-bold text-primary">980 SC</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2 text-zinc-500">
              <MessageSquare className="w-4 h-4 text-state-wait" />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">1:1 고객 문의 응대</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-zinc-500">응대 건수 측정 전</span>
              <span className="text-xs font-mono font-bold text-primary">640 SC</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2 text-zinc-500">
              <Sparkles className="w-4 h-4 text-state-warn" />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">비법 학습 & 시장 분석</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-zinc-500">분석 건수 측정 전</span>
              <span className="text-xs font-mono font-bold text-primary">350 SC</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
