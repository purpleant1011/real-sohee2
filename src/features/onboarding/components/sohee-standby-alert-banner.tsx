'use client'

import React from 'react'
import { AlertTriangle, ShieldAlert, Sparkles, Clock, CheckCircle2, ChevronRight, BellRing } from 'lucide-react'

export interface SoheeStandbyAlertBannerProps {
  currentStep: number
  totalSteps?: number
  businessName?: string
  hasChannels?: boolean
  hasSignature?: boolean
}

export function SoheeStandbyAlertBanner({
  currentStep,
  totalSteps = 5,
  businessName,
  hasChannels = false,
  hasSignature = false
}: SoheeStandbyAlertBannerProps) {
  const percent = Math.min(100, Math.round(((currentStep - 1) / totalSteps) * 100))

  return (
    <div className="w-full rounded-3xl border-2 border-state-warn/50 bg-gradient-to-r from-state-warn/15 via-state-warn/10 to-state-warn-soft p-5 sm:p-6 shadow-xl backdrop-blur-md space-y-4 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-state-warn text-state-warn-soft flex items-center justify-center shadow-lg shadow-state-warn/30 shrink-0 mt-0.5 animate-pulse">
            <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-state-warn text-state-warn-soft tracking-wide uppercase">
                <BellRing className="w-3 h-3" />
                업무 정지 경보
              </span>
              <span className="text-xs font-extrabold text-state-warn">
                소희 AI 사원 대기 모드
              </span>
            </div>

            <h3 className="text-base sm:text-lg font-black text-zinc-950 dark:text-zinc-50 tracking-tight">
              매장 주요 정보가 입력되지 않아 소희가 마케팅 업무를 시작할 수 없습니다!
            </h3>

            <p className="text-xs text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed max-w-2xl">
              사장님의 <strong>매장 인사기록부</strong>, <strong>비법 스타일</strong>, <strong>4대 채널(SNS/블로그/당근)</strong> 정보가 등록되어야 소희가 주변 상권을 분석하고 24시간 자율 홍보 활동을 가동할 수 있습니다.
            </p>
          </div>
        </div>

        {/* Status Badge & Step Counter */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-state-warn/20 border border-state-warn/40 text-state-warn text-xs font-bold font-mono">
            <Clock className="w-3.5 h-3.5 text-state-warn animate-spin" />
            <span>온보딩 진행률: {percent}% (Step {currentStep}/{totalSteps})</span>
          </div>
        </div>
      </div>

      {/* Progress Bar & Required Checklist */}
      <div className="space-y-2 pt-1 border-t border-state-warn/20">
        <div className="flex items-center justify-between text-[11px] font-bold text-zinc-600 dark:text-zinc-400">
          <span>5대 필수 온보딩 퀘스트 완료 후 즉시 마케팅이 가동됩니다</span>
          <span className="text-state-warn font-mono">{percent}% 완료</span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden p-0.5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-state-warn to-state-warn/70 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(5, percent)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
