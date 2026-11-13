'use client'

import React from 'react'
import { Gift, ArrowRight, X, Sparkles } from 'lucide-react'

export interface BenefitCelebrationCardProps {
  title?: string
  message?: string
  grantedSc: number
  campaignType?: string
  onAccept?: () => void
  onDismiss?: () => void
}

export function BenefitCelebrationCard({
  title = '소희팀에서 마케팅 크레딧을 선물했어요 🎁',
  message = '이번 주 매장 홍보와 고객 문의 늘리기에 여유롭게 써보세요.',
  grantedSc = 1000,
  campaignType = 'PROMO_CREDIT',
  onAccept,
  onDismiss,
}: BenefitCelebrationCardProps) {
  return (
    <div
      role="region"
      aria-label="혜택 및 선물 알림"
      className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-primary/20 via-slate-900 to-primary/10 p-5 shadow-lg backdrop-blur-md transition-all duration-300 hover:border-white/30"
    >
      {/* 배경 장식 광채 */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-primary/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-primary/10 blur-xl" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* 좌측 콘텐츠 */}
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white border border-white/20 shadow-inner">
            <Gift className="h-5 w-5 animate-pulse text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white border border-white/20">
                <Sparkles className="h-3 w-3" />
                +{grantedSc.toLocaleString()} SC 지급 완료
              </span>
              <span className="text-xs text-slate-400">
                {campaignType === 'COMPENSATION' ? '서비스 장애 보상' : '특별 혜택'}
              </span>
            </div>
            <h4 className="mt-1 text-base font-bold text-slate-100">{title}</h4>
            <p className="mt-0.5 text-sm text-slate-300 leading-relaxed">{message}</p>
          </div>
        </div>

        {/* 우측 액션 버튼 */}
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="닫기"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onAccept}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:bg-primary/90 active:scale-95 transition-all"
          >
            소희에게 추천 업무 맡기기
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
