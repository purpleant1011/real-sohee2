'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  Sparkles, 
  Pause, 
  Play, 
  TrendingUp, 
  Target, 
  Coins, 
  Sliders, 
  Check, 
  ChevronRight,
  ShieldCheck,
  Zap,
  BookOpen,
  CheckCircle2,
  X,
  Clock,
  Edit3,
  ExternalLink,
  ArrowRight
} from 'lucide-react'
import { AgentStateBadge } from '@/components/v088/agent-state-badge'
import { useCreditBalance } from '@/hooks/use-credit-balance'

export interface PromotionProposal {
  id: string
  title: string
  category: string
  signal: string
  targetChannel: string
  creditCostSc: number
  expectedRevenue: number
  roiMultiplier: string
  targetSlots: string
  whyNow: string
  stopCondition: string
  recommendedHarness: string
}

export const PROMOTION_PROPOSALS: PromotionProposal[] = [
  {
    id: 'prop-1',
    title: '봄맞이 첫 방문 15% 지원 프로모션',
    category: '신규 유입 & 슬롯 소진',
    signal: '화/수/목 14~17시 잔여 슬롯 6개 탐지 + 지역 봄나들이 검색량 +42% 급증',
    targetChannel: '인스타그램 릴스/피드 · 네이버 블로그 칼럼 · 당근 동네소식',
    creditCostSc: 720,
    expectedRevenue: 540000,
    roiMultiplier: '36.0x',
    targetSlots: '화/수/목 유휴 슬롯 6개 전량 소진',
    whyNow: '주말 대비 주중 비어있는 슬롯 예약률이 35%로 저조하여 72시간 전 선제 홍보가 필요합니다.',
    stopCondition: '화/수/목 오후 예약 6건 완료 즉시 프로모션 자동 종료',
    recommendedHarness: '1:1 맞춤 서비스 비법'
  },
  {
    id: 'prop-2',
    title: '재방문 주기 도래 단골 고객 복귀 10,000원 상품권 프로모션',
    category: '단골 리텐션 & 재방문',
    signal: '최근 30일 방문 고객 중 재방문 권장 주기(4~6주) 도래 고객 8명 감지',
    targetChannel: '카카오톡 알림톡 · 인스타그램 1:1 DM',
    creditCostSc: 320,
    expectedRevenue: 350000,
    roiMultiplier: '27.3x',
    targetSlots: '주말 오전 재방문 슬롯 4개 배정',
    whyNow: '방문 후 4주가 경과한 고객은 이탈률이 급증하므로 골든타임 재방문 알림이 필요합니다.',
    stopCondition: '재방문 예약 4건 접수 완료 시 자동 마감',
    recommendedHarness: '단골 고객 사후 케어 및 재방문 관리 비법'
  },
  {
    id: 'prop-3',
    title: '주말 황금 시간대 노쇼 방지 100% 예약금 결제 연동 프로모션',
    category: '매장 운영 안정화',
    signal: '토/일 주말 피크 타임 예약 마감률 95% 도달, 노쇼 리스크 사전 차단',
    targetChannel: '네이버 스마트플레이스 · 알림톡 예약 확인',
    creditCostSc: 180,
    expectedRevenue: 720000,
    roiMultiplier: '40.0x',
    targetSlots: '토/일 주말 슬롯 8개 100% 확정',
    whyNow: '주말 피크 타임 취소 공실을 원천 방지하여 매출 손실을 0원으로 만듭니다.',
    stopCondition: '주말 예약 슬롯 8개 전액 결제 완료 시 마감',
    recommendedHarness: '노쇼 방지 예약금 수납 및 골든 슬롯 관리 비법'
  }
]

const HARNESS_OPTIONS = [
  { id: 'harness-1', name: '1:1 맞춤 서비스 비법', tag: '기본 권장' },
  { id: 'harness-2', name: '유휴 슬롯 15% 할인 긴급 전환 비법', tag: '프로모션' }
]

interface SoheeLiveHeroProps {
  isPaused?: boolean
  onPauseToggle?: () => void
  selectedProposalId: string
  onSelectProposal: (id: string) => void
  workspaceId?: string
}

export function SoheeLiveHero({
  isPaused = false,
  onPauseToggle,
  selectedProposalId,
  onSelectProposal,
  workspaceId = 'ws-default'
}: SoheeLiveHeroProps) {
  const router = useRouter()
  const { consumeCredits } = useCreditBalance(workspaceId)
  const [selectedHarness, setSelectedHarness] = useState<string>('harness-1')
  const [decisionState, setDecisionState] = useState<'pending' | 'approved' | 'held' | 'rejected'>('pending')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const activeProp = PROMOTION_PROPOSALS.find(p => p.id === selectedProposalId) || PROMOTION_PROPOSALS[0]

  const handleApproveAndExecute = async () => {
    setIsSubmitting(true)
    consumeCredits(activeProp.creditCostSc)
    await new Promise(r => setTimeout(r, 600))
    setDecisionState('approved')
    setFeedbackMessage(`✅ [${activeProp.title}] 프로모션이 승인되어 소희가 선택한 비법으로 콘텐츠 자동 제작 및 게시 준비에 착수했습니다!`)
    setIsSubmitting(false)
  }

  const handleHold = () => {
    setDecisionState('held')
    setFeedbackMessage('⏸️ 해당 프로모션 제안을 보류 상태로 보관했습니다. 언제든 다시 승인하실 수 있습니다.')
  }

  const handleReject = () => {
    setDecisionState('rejected')
    setFeedbackMessage('❌ 제안이 반려되었습니다. 소희가 다른 상권 기회 데이터를 추가 분석하여 새 제안을 준비합니다.')
  }

  return (
    <div className="p-6 md:p-7 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-5">
      {/* Top Header: Identity & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-3.5">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl ring-2 ring-primary/30 overflow-hidden bg-primary shadow-xs">
              <Image
                src="/brand/sohee-character-v1.png"
                alt="마케팅 직원 소희"
                width={48}
                height={48}
                className="w-full h-full object-cover"
                priority
              />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-state-ok ring-2 ring-white dark:ring-zinc-900 animate-pulse" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base text-zinc-950 dark:text-zinc-50">
                마케팅 전담 사원 소희
              </h2>
              <AgentStateBadge state={isPaused ? 'paused' : 'running'} size="sm" />
            </div>
            <span className="text-xs text-zinc-500 font-medium">
              시장 기회 탐지 & 주간 프로모션 지휘 콘솔 · V0.9
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPauseToggle}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold transition-all border border-zinc-200 dark:border-zinc-700 cursor-pointer shadow-2xs"
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-state-ok" /> : <Pause className="w-3.5 h-3.5 text-zinc-500" />}
            <span>{isPaused ? '소희 가동 재개' : '일시 정지'}</span>
          </button>
        </div>
      </div>

      {/* Promotion Proposal Switcher Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            소희의 데이터 기반 주간 프로모션 추천 제안 (사장님 의사결정 대기)
          </span>
          <span className="text-xs text-zinc-400 font-mono">추천 프로모션 분석 결과</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-1.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800">
          {PROMOTION_PROPOSALS.map((prop, idx) => {
            const active = selectedProposalId === prop.id
            return (
              <button
                key={prop.id}
                onClick={() => {
                  onSelectProposal(prop.id)
                  setDecisionState('pending')
                  setFeedbackMessage(null)
                }}
                className={`p-3.5 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between space-y-1.5 ${
                  active
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs border-2 border-primary/50 ring-2 ring-primary/10'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 hover:bg-white/50 dark:hover:bg-zinc-800/40 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className={`px-2 py-0.5 rounded font-black ${active ? 'bg-primary/10 text-foreground dark:text-primary' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600'}`}>
                    제안 0{idx + 1}
                  </span>
                  <span className="font-extrabold text-state-ok">
                    {prop.roiMultiplier} ROI
                  </span>
                </div>
                <div className="font-bold text-xs line-clamp-1 leading-snug">{prop.title}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected Proposal Full Detail & Decision Engine */}
      <div className="p-5 md:p-6 rounded-2xl bg-primary/40 border border-primary/70 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-foreground dark:text-primary text-[10px] font-black border border-primary/30">
                {activeProp.category}
              </span>
              <span className="text-xs text-zinc-500 font-medium">타깃: {activeProp.targetSlots}</span>
            </div>
            <h3 className="text-base md:text-lg font-black text-zinc-950 dark:text-zinc-50">
              {activeProp.title}
            </h3>
          </div>

          <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-right shadow-2xs">
            <div>
              <span className="text-[10px] text-zinc-400 block font-bold">예상 창출 매출</span>
              <span className="text-xs font-black text-state-ok font-mono">₩{activeProp.expectedRevenue.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Signals & Target Channels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
            <span className="text-[11px] font-bold text-primary flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              발견된 시장 데이터 신호 (Why Now)
            </span>
            <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium">{activeProp.signal}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
            <span className="text-[11px] font-bold text-primary flex items-center gap-1">
              <Target className="w-3.5 h-3.5" />
              배포 및 타깃 마케팅 채널
            </span>
            <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed font-mono">{activeProp.targetChannel}</p>
          </div>
        </div>

        {/* 🌟 1. 하네스(비법 지식) 간결 선택기 */}
        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-extrabold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-primary" />
              <span>적용할 매장 비법 선택:</span>
            </span>
            <Link
              href="/app/sohee?tab=training"
              className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5"
            >
              <span>비법 관리</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {HARNESS_OPTIONS.map((h) => {
              const isSelected = selectedHarness === h.id
              return (
                <button
                  key={h.id}
                  onClick={() => setSelectedHarness(h.id)}
                  className={`px-3.5 py-2 rounded-xl border font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary text-white border-primary shadow-2xs'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                  <span>{h.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${isSelected ? 'bg-primary text-primary' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'}`}>
                    {h.tag}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Feedback Message */}
        {feedbackMessage && (
          <div className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in ${
            decisionState === 'approved'
              ? 'bg-state-ok-soft border-state-ok/40 text-state-ok'
              : decisionState === 'held'
              ? 'bg-state-warn-soft border-state-warn/40 text-state-warn'
              : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
          }`}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-state-ok flex-shrink-0" />
              <span>{feedbackMessage}</span>
            </div>

            {decisionState === 'approved' && (
              <Link
                href="/app/content"
                className="px-3 py-1.5 rounded-xl bg-state-ok hover:bg-state-ok/90 text-white text-xs font-extrabold flex items-center gap-1 shadow-2xs whitespace-nowrap"
              >
                <span>콘텐츠 스튜디오 & 대기열 확인</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        )}

        {/* 🌟 2. 사장님 의사결정 액션 바 (The Decision Action Bar) */}
        <div className="pt-2 border-t border-primary/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {decisionState !== 'approved' ? (
              <button
                onClick={handleApproveAndExecute}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait text-white font-black text-xs transition-all shadow-md shadow-primary/25 cursor-pointer"
              >
                <Zap className="w-4 h-4 text-state-warn fill-state-warn" />
                <span>{isSubmitting ? '승인 처리 및 실행 중...' : '⚡ 제안 즉시 승인 및 콘텐츠 자동 제작 실행'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-state-ok-soft text-state-ok font-extrabold text-xs border border-state-ok/40">
                <Check className="w-4 h-4 text-state-ok" />
                <span>승인 완료됨 (소희가 콘텐츠 제작 진행 중)</span>
              </div>
            )}

            <button
              onClick={handleHold}
              className="px-4 py-2.5 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-100 transition-all cursor-pointer shadow-2xs flex items-center gap-1"
            >
              <Clock className="w-3.5 h-3.5 text-state-warn" />
              <span>보류</span>
            </button>

            <button
              onClick={handleReject}
              className="px-4 py-2.5 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs hover:bg-zinc-100 transition-all cursor-pointer shadow-2xs flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5 text-zinc-400" />
              <span>반려</span>
            </button>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>{expanded ? '상세 조건 접기' : '자동 중단 및 예산 보호 조건 보기'}</span>
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {expanded && (
          <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs space-y-1 animate-in fade-in">
            <span className="font-bold text-zinc-700 dark:text-zinc-300 block">🛑 자동 중단 및 안전 가드레일:</span>
            <p className="text-state-warn font-mono font-medium">{activeProp.stopCondition}</p>
          </div>
        )}
      </div>
    </div>
  )
}
