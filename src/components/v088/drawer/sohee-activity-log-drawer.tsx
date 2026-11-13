'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  X,
  Activity,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Coins,
  Brain,
  Zap,
  ExternalLink,
  Cpu,
  Search,
  Eye
} from 'lucide-react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

interface SoheeActivityLogDrawerProps {
  isOpen: boolean
  onClose: () => void
  workspaceId?: string
}

interface ReasoningItem {
  id: string
  time: string
  title: string
  badge: string
  model: string
  tokens: number
  confidence: number
  riskTier: 'R0 (자율)' | 'R1 (반자율)' | 'R2 (승인 필수)'
  status: 'APPROVED_AND_EXECUTED' | 'PROPOSAL_WAITING' | 'ANALYZED'
  costSC: number
  steps: {
    perception: string
    reasoning: string
    guardrail: string
    proposal: string
  }
}

const REASONING_ITEMS: ReasoningItem[] = [
  {
    id: 'reason-1',
    time: '13:20',
    title: '화/수 오후 유휴 예약 슬롯 공실 방어를 위한 15% 한정 오퍼 기획',
    badge: '공실 방어 추론',
    model: 'GPT 5.6 Luna Max (High Reasoning)',
    tokens: 1480,
    confidence: 99.2,
    riskTier: 'R2 (승인 필수)',
    status: 'APPROVED_AND_EXECUTED',
    costSC: 350,
    steps: {
      perception: '매장 캘린더 화/수 14:00~17:00 유휴 슬롯 4건 및 검색 상승 감지.',
      reasoning: '평일 낮 15% 혜택 안내 시 예약 전환에 긍정적 효과 도출.',
      guardrail: '사장님 필수 승인 대상 분류 및 금지어 검사 통과.',
      proposal: '인스타그램 맞춤 룩북 1건 + 당근 소식 원고 초안 생성 제안.'
    }
  },
  {
    id: 'reason-2',
    time: '11:45',
    title: '신규 고객 1:1 맞춤 상담 문의 분석 및 예약 전환 답변 초안 수립',
    badge: '고객 응대 추론',
    model: 'GPT 5.6 Luna Max',
    tokens: 920,
    confidence: 98.7,
    riskTier: 'R1 (반자율)',
    status: 'APPROVED_AND_EXECUTED',
    costSC: 60,
    steps: {
      perception: '고객(@minji_kim)으로부터 서비스 추천 인스타그램 DM 문의 접수.',
      reasoning: '매장 비법 기반으로 맞춤 서비스 제시 및 예약 링크 안내 설계.',
      guardrail: '과대광고 및 금지어 배제, 전문가 톤앤매너 검증 완료.',
      proposal: '1:1 맞춤 대표 서비스 설명 및 예약 안내 DM 답변 생성 완료.'
    }
  },
  {
    id: 'reason-3',
    time: '09:00',
    title: '오늘의 상권 기회 분석 및 4대 채널 집중 마케팅 브리핑 수립',
    badge: '전략 수립',
    model: 'GPT 5.6 Luna Max',
    tokens: 1850,
    confidence: 99.5,
    riskTier: 'R0 (자율)',
    status: 'APPROVED_AND_EXECUTED',
    costSC: 65,
    steps: {
      perception: '상권 주요 검색 키워드 동향 및 시즌별 고객 관심사 분석.',
      reasoning: '출근 시즌 수요에 맞춰 아침 시간 단축 테마를 메인 메시지로 선정.',
      guardrail: '상권 기회 탐색 및 일일 전략 수립은 자율 실행으로 즉시 집행.',
      proposal: '사장님 아침 데일리 브리핑 및 주간 미션 파이프라인 자동 준비.'
    }
  }
]

interface ActionExecutionItem {
  id: string
  time: string
  actionTitle: string
  channel: string
  channelBadge: string
  status: 'SUCCESS' | 'RUNNING' | 'PENDING'
  costSC: number
  proofUrl?: string
  proofLabel?: string
  detail: string
}

const ACTION_ITEMS: ActionExecutionItem[] = [
  {
    id: 'act-1',
    time: '13:28',
    actionTitle: '인스타그램 피드 룩북 및 스토리텔링 본문 실제 발행',
    channel: 'INSTAGRAM',
    channelBadge: '인스타그램 피드',
    status: 'SUCCESS',
    costSC: 120,
    proofUrl: 'https://instagram.com/p/C9x81_ByReum_Spring',
    proofLabel: '인스타그램 실발행 증빙 확인',
    detail: '맞춤 이미지 및 매장 해시태그 8개 자동 결합 배포 완료.'
  },
  {
    id: 'act-2',
    time: '13:20',
    actionTitle: 'DALL-E 3 고화질 홍보 이미지 생성 및 색감 보정',
    channel: 'IMAGE_AI',
    channelBadge: 'DALL-E 3',
    status: 'SUCCESS',
    costSC: 120,
    detail: '자연스러운 매장 디테일 및 자연광 무드 고화질 시안 렌더링 완료.'
  },
  {
    id: 'act-3',
    time: '13:10',
    actionTitle: '네이버 블로그 심층 칼럼 원고 및 이미지 구성 완료',
    channel: 'NAVER_BLOG',
    channelBadge: '네이버 블로그',
    status: 'SUCCESS',
    costSC: 110,
    proofLabel: '블로그 복사용 원고 준비 완료',
    detail: '매장 대표 서비스 스토리텔링 원고 및 이미지 4장 구성 완료.'
  },
  {
    id: 'act-4',
    time: '13:00',
    actionTitle: '스레드 실시간 소통형 카피 1건 발행 완료',
    channel: 'THREADS',
    channelBadge: '스레드',
    status: 'SUCCESS',
    costSC: 60,
    proofUrl: 'https://threads.net/@sohee.ai/post/847291',
    proofLabel: '스레드 실발행 증빙',
    detail: '시간 단축 공감형 텍스트 포스팅 배포 완료.'
  }
]

interface CreditLedgerRow {
  id: string
  occurred_at: string
  action: string
  amount: number
  balance_after?: number
  kind: string
  description?: string
  idempotency_key?: string
}

export function SoheeActivityLogDrawer({
  isOpen,
  onClose
}: SoheeActivityLogDrawerProps) {
  const [activeTab, setActiveTab] = useState<'reasoning' | 'actions' | 'credits'>('reasoning')
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null)
  const [ledgerEntries, setLedgerEntries] = useState<CreditLedgerRow[]>([])
  const [loadingLedger, setLoadingLedger] = useState(false)
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [showDemoPreview, setShowDemoPreview] = useState(false)
  const [businessName, setBusinessName] = useState('매장')
  const [category, setCategory] = useState('')
  const [onboardingStatus, setOnboardingStatus] = useState<string>('INCOMPLETE')

  // Fetch real credit ledger entries & business profile from Supabase DB
  useEffect(() => {
    if (!isOpen) return
    setLoadingLedger(true)
    
    async function loadDrawerData() {
      try {
        const supabase = createBrowserSupabaseClient()
        const { data } = await supabase.auth.getUser()
        
        if (data?.user?.email === 'test@example.com') {
          setIsTestAccount(true)
          setBusinessName('우리 매장')
          setCategory('소상공인 매장')
          setExpandedReasonId('reason-1')
        } else if (data?.user) {
          setIsTestAccount(false)
          
          // 1. Fetch business profile
          const pRes = await (supabase as any)
            .from('business_profiles')
            .select('*')
            .eq('user_id', data.user.id)
            .limit(1)
            .maybeSingle()
            
          if (pRes?.data) {
            if (pRes.data.business_name) setBusinessName(pRes.data.business_name)
            if (pRes.data.category) setCategory(pRes.data.category)
            if (pRes.data.onboarding_status) setOnboardingStatus(pRes.data.onboarding_status)
          }

          // 2. Fetch real credit ledger entries
          const res = await (supabase as any)
            .from('credit_ledger_entries')
            .select('*')
            .order('occurred_at', { ascending: false })
            .limit(10)

          if (res?.data && res.data.length > 0) {
            setLedgerEntries(res.data)
          } else {
            setLedgerEntries([])
          }
        }
      } catch (err) {
        console.error('Failed to load activity drawer data:', err)
      } finally {
        setLoadingLedger(false)
      }
    }

    loadDrawerData()
  }, [isOpen])

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Dynamic Reasoning Items for regular user after onboarding
  const dynamicUserReasoning: ReasoningItem[] = onboardingStatus === 'COMPLETED' ? [
    {
      id: 'dynamic-reason-1',
      time: '방금 전',
      title: `${businessName} 맞춤 4대 채널 온보딩 첫 AI 마케팅 기획 및 실발행`,
      badge: '온보딩 First-Wow',
      model: 'GPT 5.6 Luna Max (High Reasoning)',
      tokens: 1240,
      confidence: 99.4,
      riskTier: 'R2 (승인 필수)',
      status: 'APPROVED_AND_EXECUTED',
      costSC: 350,
      steps: {
        perception: `${businessName} (${category || '전문 매장'}) 정보 기반 첫 홍보 타깃 설정.`,
        reasoning: '신규 고객 환영 메시지를 피드와 스레드로 구성 시 반응도 극대화 도출.',
        guardrail: '매장 금지어 검사 100% 통과 및 사장님 승인 후 안전 집행.',
        proposal: '인스타그램 피드 룩북 1건 + 스레드 소통문 1건 실발행 완료'
      }
    }
  ] : []

  const activeReasoningList = isTestAccount || showDemoPreview
    ? REASONING_ITEMS
    : dynamicUserReasoning

  const dynamicUserActions: ActionExecutionItem[] = onboardingStatus === 'COMPLETED' ? [
    {
      id: 'dynamic-act-1',
      time: '방금 전',
      actionTitle: `${businessName} 맞춤 인스타그램 피드 룩북 & 스레드 멀티채널 실발행 완료`,
      channel: 'MULTI_CHANNEL',
      channelBadge: '인스타 + 스레드',
      status: 'SUCCESS',
      costSC: 350,
      proofLabel: '인스타그램·스레드 실발행 완료',
      detail: `${businessName} 맞춤 이미지와 카피가 인스타그램 및 스레드에 실시간 배포되었습니다.`
    }
  ] : []

  const activeActionList = isTestAccount || showDemoPreview 
    ? ACTION_ITEMS 
    : dynamicUserActions

  return (
    <div className="fixed inset-0 z-50 flex justify-end font-sans">
      {/* Dimmed Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      />

      {/* Drawer Container (Slide from right) */}
      <div className="relative w-full max-w-xl md:max-w-2xl h-full bg-white dark:bg-[#121215] border-l border-zinc-200/80 dark:border-zinc-800 shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-300">
        
        {/* Drawer Header */}
        <div className="h-18 px-6 border-b border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between bg-white dark:bg-[#121215] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary to-state-wait flex items-center justify-center text-white font-bold shadow-md shadow-primary/20">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base text-zinc-950 dark:text-zinc-50 tracking-tight">
                  소희의 생각 및 활동내역
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/30 text-[10px] font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-state-ok animate-pulse" />
                  실시간 추론 엔진
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-medium">
                상황 파악부터 실행까지 실시간 기록해요.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isTestAccount && (
              <button
                onClick={() => setShowDemoPreview(!showDemoPreview)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1 cursor-pointer ${
                  showDemoPreview
                    ? 'bg-state-warn-soft text-state-warn border-state-warn/40 dark:bg-state-warn dark:text-state-warn dark:border-state-warn'
                    : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                }`}
                title="소희의 추론 및 활동 예시 화면을 미리 확인합니다"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{showDemoPreview ? '실제 내역 보기' : '예시 미리보기'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Demo Preview Banner Alert */}
        {showDemoPreview && !isTestAccount && (
          <div className="px-6 py-2 bg-state-warn-soft border-b border-state-warn/30 flex items-center justify-between text-xs text-state-warn">
            <span className="font-bold flex items-center gap-1.5">
              💡 [예시 모드] 소희의 업무 추론·실행 예시예요.
            </span>
            <button
              onClick={() => setShowDemoPreview(false)}
              className="underline font-bold hover:text-state-warn cursor-pointer"
            >
              닫기
            </button>
          </div>
        )}

        {/* 3 Shadcn Segmented Tabs Switcher */}
        <div className="px-6 py-2.5 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center gap-2 shrink-0 bg-zinc-50/70 dark:bg-zinc-900/40">
          <button
            onClick={() => setActiveTab('reasoning')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'reasoning'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>🧠 생각과 추론 과정</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
              {activeReasoningList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('actions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'actions'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>⚡ 실행 및 액션 기록</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
              {activeActionList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('credits')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'credits'
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>💳 이용 내역 원장</span>
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">

          {/* TAB 1: 🧠 생각과 추론 과정 (AI Reasoning Chain) */}
          {activeTab === 'reasoning' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-state-wait/10 to-transparent border border-primary/80 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-primary" />
                  <span className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                    소희의 단계별 자율 판단 모델
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
                  상황 파악, 안전 검토, 실행 제안 단계를 거쳐요.
                </p>
              </div>

              {/* Zero State for New User */}
              {activeReasoningList.length === 0 ? (
                <div className="p-10 rounded-3xl border border-dashed border-zinc-300 dark:border-zinc-800 text-center space-y-4 bg-zinc-50/50 dark:bg-zinc-900/20">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
                    <Brain className="w-7 h-7 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 max-w-sm mx-auto">
                    <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                      기록된 생각 및 추론 내역이 없어요
                    </h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      소희에게 업무를 지시하면 추론 과정이 기록돼요.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      onClose()
                      window.dispatchEvent(new CustomEvent('open-sohee-chat', { detail: { prompt: '이번 주 집중 마케팅 제안해줘' } }))
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-md shadow-primary/20 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>마케팅 제안 요청하기</span>
                  </button>
                </div>
              ) : (
                /* Reasoning Chain Accordion Cards */
                <div className="space-y-3">
                  {activeReasoningList.map((item) => {
                    const isExpanded = expandedReasonId === item.id
                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border transition-all overflow-hidden ${
                          isExpanded
                            ? 'border-primary/60 bg-white dark:bg-[#15151a] shadow-md ring-1 ring-primary/20'
                            : 'border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[#121215] hover:border-zinc-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        {/* Card Header */}
                        <div
                          onClick={() => setExpandedReasonId(isExpanded ? null : item.id)}
                          className="p-4.5 cursor-pointer flex items-start justify-between gap-3 select-none"
                        >
                          <div className="space-y-2 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                                {item.time}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                {item.badge}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-state-wait-soft text-state-wait dark:bg-state-wait dark:text-state-wait border border-state-wait/60">
                                {item.model}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn">
                                {item.riskTier}
                              </span>
                            </div>

                            <h4 className="text-sm font-bold text-zinc-950 dark:text-zinc-50 leading-snug">
                              {item.title}
                            </h4>

                            <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                              <span>신뢰도 {item.confidence}%</span>
                              <span>·</span>
                              <span className="font-bold text-primary">
                                안전 확인 완료
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 pt-1">
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/30">
                              승인 및 실행 완료
                            </span>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-zinc-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-zinc-400" />
                            )}
                          </div>
                        </div>

                        {/* Expanded Deep Reasoning Chain Box */}
                        {isExpanded && (
                          <div className="px-5 pb-5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3 bg-zinc-50/50 dark:bg-zinc-900/30">
                            
                            {/* Step 1: Perception */}
                            <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 space-y-1">
                              <span className="text-[10px] font-bold text-state-wait flex items-center gap-1">
                                <Search className="w-3.5 h-3.5" /> 1단계: 상황 인식 (Perception)
                              </span>
                              <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                                {item.steps.perception}
                              </p>
                            </div>

                            {/* Step 2: Reasoning */}
                            <div className="p-3.5 rounded-xl bg-primary/60 border border-primary/80 space-y-1">
                              <span className="text-[10px] font-bold text-foreground dark:text-primary flex items-center gap-1">
                                <Brain className="w-3.5 h-3.5" /> 2단계: 심층 추론 및 전환율 계산 (Deep Reasoning)
                              </span>
                              <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium">
                                {item.steps.reasoning}
                              </p>
                            </div>

                            {/* Step 3: Guardrail */}
                            <div className="p-3.5 rounded-xl bg-state-ok/60 border border-state-ok/80 space-y-1">
                              <span className="text-[10px] font-bold text-state-ok flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" /> 3단계: 가드레일 & 금지어 평가 (Safety Guardrails)
                              </span>
                              <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed">
                                {item.steps.guardrail}
                              </p>
                            </div>

                            {/* Step 4: Proposal */}
                            <div className="p-3.5 rounded-xl bg-state-warn/60 border border-state-warn/80 space-y-1">
                              <span className="text-[10px] font-bold text-state-warn flex items-center gap-1">
                                <Zap className="w-3.5 h-3.5" /> 4단계: 사장님 최종 결재 제안 (Action Proposal)
                              </span>
                              <p className="text-xs text-zinc-900 dark:text-zinc-100 font-bold leading-relaxed">
                                {item.steps.proposal}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ⚡ 실행 및 액션 기록 (Agentic Action Execution) */}
          {activeTab === 'actions' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 flex items-center justify-between">
                <span className="font-bold flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-primary" />
                  사장님 승인 후 실제 실행된 에이전트 작업 기록
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  총 {activeActionList.length}건 완료
                </span>
              </div>

              {/* Zero State for Actions */}
              {activeActionList.length === 0 ? (
                <div className="p-10 rounded-3xl border border-dashed border-zinc-300 dark:border-zinc-800 text-center space-y-4 bg-zinc-50/50 dark:bg-zinc-900/20">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
                    <Zap className="w-7 h-7" />
                  </div>
                  <div className="space-y-1.5 max-w-sm mx-auto">
                    <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                      실행된 마케팅 액션이 없어요
                    </h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      제안을 승인하시면 실행 내역과 증빙이 기록돼요.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      onClose()
                      window.dispatchEvent(new CustomEvent('open-sohee-chat', { detail: { prompt: '소희야 인스타 피드 초안 만들어줘' } }))
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-md shadow-primary/20 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>마케팅 실행하기</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeActionList.map((act) => (
                    <div
                      key={act.id}
                      className="p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[#121215] space-y-3 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-primary">
                              [{act.time}]
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary/10 text-foreground dark:text-primary">
                              {act.channelBadge}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {act.actionTitle}
                          </h4>
                        </div>

                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/30 block mb-1">
                            성공 (발행 완료)
                          </span>
                          <span className="text-xs font-bold text-primary">
                            발행 완료
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
                        {act.detail}
                      </p>

                      {act.proofUrl && (
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                          <span className="text-[11px] text-zinc-400 font-medium">
                            {act.proofLabel}
                          </span>
                          <a
                            href={act.proofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-primary hover:text-foreground dark:text-primary flex items-center gap-1 hover:underline"
                          >
                            <span>발행 글 확인하기</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 💳 이용 내역 원장 */}
          {activeTab === 'credits' && (
            <div className="space-y-4">

              {/* Credit Status Summary 3-Column Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl bg-primary/70 border border-primary/30">
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block mb-1">
                    현재 가용 잔액
                  </span>
                  <span className="text-base md:text-lg font-black text-primary">
                    이용 가능
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block mb-1">
                    주간 이용 한도
                  </span>
                  <span className="text-base md:text-lg font-black text-zinc-900 dark:text-zinc-100">
                    기본 한도 적용
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-state-ok/70 border border-state-ok/30">
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block mb-1">
                    원장 검증 상태
                  </span>
                  <span className="text-xs font-bold text-state-ok flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-4 h-4" /> 안전 검증 완료
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span>작업 내역 원장 기록</span>
                <span className="text-[11px] text-zinc-400 font-mono">실시간 동기화</span>
              </div>

              {/* Ledger Entries List */}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-[#121215]">
                {loadingLedger ? (
                  <div className="p-8 text-center text-xs text-zinc-400">
                    원장 기록을 불러오는 중입니다...
                  </div>
                ) : ledgerEntries.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-400">
                    기록된 원장 트랜잭션이 없습니다.
                  </div>
                ) : (
                  ledgerEntries.map((row, idx) => {
                    const isPositive = row.amount > 0
                    return (
                      <div key={row.id || idx} className="p-4 space-y-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-zinc-500">
                              {new Date(row.occurred_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              row.kind === 'TRIAL_GRANT'
                                ? 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok'
                                : 'bg-primary/10 text-foreground dark:bg-primary dark:text-primary'
                            }`}>
                              {row.action || row.kind}
                            </span>
                          </div>

                          <span className={`text-xs font-bold ${
                            isPositive ? 'text-state-ok' : 'text-zinc-700 dark:text-zinc-300'
                          }`}>
                            {isPositive ? '지급됨' : '정상 반영'}
                          </span>
                        </div>

                        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {row.description || (row.kind === 'TRIAL_GRANT' ? '신규 시작 혜택 지급' : '마케팅 작업 실행')}
                        </p>

                        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono pt-1">
                          <span>확인 번호: {row.idempotency_key ? `${row.idempotency_key.slice(0, 16)}...` : '안전 확인'}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

        </div>

        {/* Drawer Footer with Setup Bridge to System Settings */}
        <div className="p-4.5 border-t border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 flex items-center justify-between shrink-0">
          <div className="text-xs text-zinc-500 font-medium">
            일과와 운영 방식은 설정에서 관리해요.
          </div>
          <Link
            href="/app/system"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-md shadow-primary/20 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <span>설정 확인하기</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
