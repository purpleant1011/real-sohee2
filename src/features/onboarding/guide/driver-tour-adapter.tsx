'use client'

import React, { useState, useEffect } from 'react'
import { Sparkles, ArrowRight, X, HelpCircle, CheckCircle } from 'lucide-react'

export interface TourStep {
  selector: string
  title: string
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export const ONBOARDING_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-sohee-tour="step-1-profile"]',
    title: '매장 기본 정보 직접 등록',
    content: '상호, 주소, 대표 메뉴와 매장 특징을 입력해 주시면 소희가 사장님 매장 맞춤으로 학습해요.'
  },
  {
    selector: '[data-sohee-tour="step-2-voice"]',
    title: '사장님 취향의 6종 맞춤 말투',
    content: '친근함, 트렌디, 담백함, 전문성, 위트, 장인 정신 중 매장 분위기에 어울리는 소희의 보이스를 선택해 보세요.'
  },
  {
    selector: '[data-sohee-tour="step-3-channels"]',
    title: '4채널 원클릭 맞춤 글 만들기',
    content: '인스타그램, 스레드, 네이버 블로그, 당근 비즈프로필 맞춤 글과 이미지를 한 번에 준비하고 채널별 예상 화면으로 확인하세요.'
  },
  {
    selector: '[data-sohee-tour="step-4-approval"]',
    title: '사장님 안심 승인 원칙',
    content: '소희가 작성한 글은 사장님이 직접 확인하고 OK(승인)한 것만 안전하게 게시돼요. 승인 전에는 아무것도 올라가지 않아요.'
  }
]

export interface DriverTourAdapterProps {
  isOpen?: boolean
  onClose?: () => void
  isFloating?: boolean
}

export function DriverTourAdapter({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  isFloating = false
}: DriverTourAdapterProps = {}) {
  const [internalActive, setInternalActive] = useState(false)
  const [currentStepIdx, setCurrentStepIdx] = useState(0)

  const isActive = controlledIsOpen !== undefined ? controlledIsOpen : internalActive
  const setIsActive = (active: boolean) => {
    if (controlledIsOpen !== undefined) {
      if (!active && controlledOnClose) controlledOnClose()
    } else {
      setInternalActive(active)
    }
  }

  const step = ONBOARDING_TOUR_STEPS[currentStepIdx]

  const handleNext = () => {
    if (currentStepIdx < ONBOARDING_TOUR_STEPS.length - 1) {
      setCurrentStepIdx(currentStepIdx + 1)
    } else {
      setIsActive(false)
      setCurrentStepIdx(0)
    }
  }

  return (
    <>
      {/* Help Launcher Floating Trigger Button (Optional) */}
      {isFloating && (
        <button
          onClick={() => {
            setIsActive(true)
            setCurrentStepIdx(0)
          }}
          className="fixed bottom-6 right-6 z-40 p-3 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 flex items-center gap-2 text-xs font-bold transition-transform hover:scale-105 cursor-pointer"
          aria-label="온보딩 가이드 튜토리얼 다시보기"
        >
          <Sparkles className="w-4 h-4 animate-spin" />
          <span>소희 AI 가이드</span>
        </button>
      )}

      {/* Tour Spotlight Popover Overlay */}
      {isActive && step && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#15151a] border border-primary/40 p-6 shadow-2xl space-y-4 text-zinc-900 dark:text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-xl bg-primary/10 text-primary font-mono font-black flex items-center justify-center text-xs">
                  {currentStepIdx + 1}
                </span>
                <h4 className="font-extrabold text-sm text-zinc-950 dark:text-zinc-50">{step.title}</h4>
              </div>
              <button
                onClick={() => {
                  setIsActive(false)
                  setCurrentStepIdx(0)
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium">
              {step.content}
            </p>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1 text-[11px] font-bold text-zinc-400 font-mono">
                <span>{currentStepIdx + 1} / {ONBOARDING_TOUR_STEPS.length}</span>
              </div>

              <div className="flex items-center gap-2">
                {currentStepIdx > 0 && (
                  <button
                    onClick={() => setCurrentStepIdx(currentStepIdx - 1)}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    이전
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all shadow-md shadow-primary/20 flex items-center gap-1 cursor-pointer"
                >
                  <span>{currentStepIdx === ONBOARDING_TOUR_STEPS.length - 1 ? '가이드 완료' : '다음'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
