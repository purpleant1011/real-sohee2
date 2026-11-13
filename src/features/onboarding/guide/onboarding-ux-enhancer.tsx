'use client'

import React, { useState, useEffect } from 'react'
import { AlertCircle, HelpCircle, Sparkles, X, ChevronUp } from 'lucide-react'

export interface StuckDetectionProps {
  currentStep: number
  category: string
  onAutoHelp?: () => void
}

export function OnboardingUxEnhancer({ currentStep, category, onAutoHelp }: StuckDetectionProps) {
  const [showStuckNudge, setShowStuckNudge] = useState(false)
  const [stepSeconds, setStepSeconds] = useState(0)

  // Category specific intelligent advice
  const getCategoryAdvice = (cat: string, step: number) => {
    if (step === 1) {
      return cat.includes('뷰티') || cat.includes('반영구')
        ? '💡 팁: 인근 3km 내 20~40대 여성 고객이 가장 많이 검색하는 키워드는 "자연스러운 결"입니다.'
        : '💡 팁: 상호명과 매장 위치를 정확히 적어주시면 네이버 플레이스 및 지도 검색 최적화가 적용됩니다.'
    }
    if (step === 2) {
      return '💡 팁: 사장님의 시그니처 서비스 1가지만 적어주셔도 소희가 매력적인 스토리텔링을 완성합니다.'
    }
    if (step === 3) {
      return '💡 팁: 계정 아이디(@아이디)를 연결해 주시면 승인 후 Meta 공식 API를 통해 맞춤 콘텐츠가 발행됩니다.'
    }
    if (step === 4) {
      return '💡 팁: "공실 방어"를 선택하시면 비인기 낮 시간대 예약 전환율을 집중적으로 끌어올립니다.'
    }
    return '💡 팁: 지금 [첫 AI 실발행 체험하기]를 누르시면 사장님 승인을 거쳐 인스타/스레드 룩북이 준비됩니다.'
  }

  // Track step duration & trigger proactive stuck nudge after 35s
  useEffect(() => {
    setStepSeconds(0)
    setShowStuckNudge(false)

    const timer = setInterval(() => {
      setStepSeconds((prev) => {
        if (prev + 1 >= 35 && !showStuckNudge) {
          setShowStuckNudge(true)
        }
        return prev + 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [currentStep])

  return (
    <div className="space-y-3">
      {/* 🌟 AI Guide Contextual Personalized Hint */}
      <div className="p-3.5 rounded-2xl bg-primary/10 border border-primary/30 flex items-start gap-2.5 text-xs text-primary animate-in fade-in duration-200">
        <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <span className="font-bold block text-[11px] text-primary uppercase tracking-wide">
            소희의 {category} 맞춤 조언
          </span>
          <p className="mt-0.5 leading-relaxed font-medium">{getCategoryAdvice(category, currentStep)}</p>
        </div>
      </div>

      {/* 🌟 Proactive Stuck Detection Nudge (Appears after 35s of inactivity) */}
      {showStuckNudge && (
        <div className="p-4 rounded-2xl bg-state-warn-soft border border-state-warn/40 flex items-start justify-between gap-3 text-xs text-state-warn animate-in slide-in-from-bottom duration-300 shadow-md">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-state-warn shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold block text-xs">작성에 어려움이 있으신가요?</span>
              <p className="mt-0.5 text-[11px] text-state-warn leading-relaxed">
                기본값으로 진행하셔도 나중에 [나의 소희]에서 언제든 수정하실 수 있습니다. 지금 바로 다음 단계로 넘어가실 수 있어요!
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowStuckNudge(false)}
            className="p-1 rounded-lg text-state-warn hover:text-state-warn/80 cursor-pointer shrink-0"
            aria-label="알림 닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
