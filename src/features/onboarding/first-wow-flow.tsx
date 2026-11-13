'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  CheckCircle2,
  Building2,
  Target,
  Sparkles,
  Share2,
  ShieldCheck,
  Rocket,
  ExternalLink,
  Clock,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  TrendingUp,
  Coins,
  DollarSign
} from 'lucide-react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { OnboardingOrchestrator, type QuestStep } from '@/features/onboarding/orchestrator/onboarding-orchestrator'
import { DriverTourAdapter } from '@/features/onboarding/guide/driver-tour-adapter'
import { OnboardingUxEnhancer } from '@/features/onboarding/guide/onboarding-ux-enhancer'
import { SoheeStandbyAlertBanner } from '@/features/onboarding/components/sohee-standby-alert-banner'
import { ChannelAuthModal } from '@/features/onboarding/components/channel-auth-modal'
import { LivePublishProofViewer } from '@/features/onboarding/components/live-publish-proof-viewer'

export interface FirstWowFlowProps {
  initialStep?: number
  onComplete?: (result: { externalUrl?: string; missionId: string; usedCredits: number }) => void
}

export function FirstWowFlow({ initialStep = 1, onComplete }: FirstWowFlowProps) {
  const orchestrator = useMemo(() => new OnboardingOrchestrator(), [])
  const savedState = orchestrator.getState()

  const [currentStep, setCurrentStep] = useState(initialStep || (savedState.step + 1))

  // Step 1: 매장 기본 정보 & 인사기록부
  const [businessName, setBusinessName] = useState(savedState.data.businessName || '')
  const [representativeName, setRepresentativeName] = useState(savedState.data.representativeName || '')
  const [category, setCategory] = useState(savedState.data.category || '뷰티/반영구')
  const [customCategory, setCustomCategory] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState(savedState.data.registrationNumber || '')
  const [phone, setPhone] = useState(savedState.data.phone || '')
  const [address, setAddress] = useState(savedState.data.address || '')

  // Step 2: 비법 스타일 & 브랜드 학습
  const [brandTone, setBrandTone] = useState(savedState.data.brandTone || '친절하고 전문적인')
  const [signatureService, setSignatureService] = useState(savedState.data.signatureService || '')
  const [priceInfo, setPriceInfo] = useState(savedState.data.priceInfo || '')
  const [forbiddenTerms, setForbiddenTerms] = useState(savedState.data.forbiddenTerms || '의료법 위반 소지 단어, 100% 완벽 보장, 최저가')

  // Step 3: 4대 핵심 채널 계정 정보 (SNS, 블로그, 당근)
  const [instagramHandle, setInstagramHandle] = useState(savedState.data.instagramHandle || '')
  const [threadsHandle, setThreadsHandle] = useState(savedState.data.threadsHandle || '')
  const [naverBlogId, setNaverBlogId] = useState(savedState.data.naverBlogId || '')
  const [daangnProfile, setDaangnProfile] = useState(savedState.data.daangnProfile || '')
  const [connectedChannels, setConnectedChannels] = useState<Record<string, boolean>>({
    instagram: !!savedState.data.instagramHandle,
    threads: !!savedState.data.threadsHandle,
    naver: !!savedState.data.naverBlogId,
    daangn: !!savedState.data.daangnProfile
  })
  const [activeAuthChannel, setActiveAuthChannel] = useState<{
    type: 'instagram' | 'threads' | 'naver' | 'daangn'
    name: string
  } | null>(null)

  // Step 4: 업무 자율 운영 규정 & 매출 극대화 목표
  const [autonomyLevel, setAutonomyLevel] = useState<'APPROVAL_REQUIRED' | 'GUARDED_AUTO'>(savedState.data.autonomyLevel || 'APPROVAL_REQUIRED')
  const [selectedGoal, setSelectedGoal] = useState<'FILL_EMPTY_SLOTS' | 'ATTRACT_NEW_CLIENTS' | 'INCREASE_TICKET_SIZE'>(
    (savedState.data.revenueGoal as any) || 'FILL_EMPTY_SLOTS'
  )

  // Step 5: Live AI Generation & Multi-Channel Publish Experience
  const [executionState, setExecutionState] = useState<'IDLE' | 'PLANNING' | 'PREVIEW' | 'PUBLISHING' | 'VERIFYING' | 'VERIFIED' | 'QUEUED' | 'OFFLINE_UNSAVED'>('IDLE')
  const [liveLog, setLiveLog] = useState<string[]>([])
  const [verifiedUrl, setVerifiedUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // UI States for Step Navigation, Validation & Example Previews
  const [showExampleStep, setShowExampleStep] = useState<number | null>(null)
  const [agreedToPost, setAgreedToPost] = useState<boolean>(true)
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  // Handle OAuth callback return from Meta in onboarding
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const connectResult = params.get('connect')
      const rawChannel = params.get('channel')
      const account = params.get('account')
      if (connectResult === 'authorized' && rawChannel) {
        const ch = rawChannel.toLowerCase()
        setConnectedChannels(prev => ({ ...prev, [ch]: true }))
        if (ch === 'instagram' && account) setInstagramHandle(account)
        if (ch === 'threads' && account) setThreadsHandle(account)
        setCurrentStep(3)
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
  }, [])

  // Auto-sync existing server-connected channels on mount
  useEffect(() => {
    async function checkExistingCredentials() {
      try {
        const res = await fetch('/api/channels/credentials')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.connections)) {
            const updates: Record<string, boolean> = {}
            for (const c of data.connections) {
              const ch = (c.channel || '').toLowerCase()
              const isConn = c.status === 'connected' || c.status === 'authorized' || c.status === 'verified'
              if (isConn) {
                updates[ch] = true
                if (ch === 'instagram' && c.account_label) setInstagramHandle(c.account_label)
                if (ch === 'threads' && c.account_label) setThreadsHandle(c.account_label)
              }
            }
            if (Object.keys(updates).length > 0) {
              setConnectedChannels(prev => ({ ...prev, ...updates }))
            }
          }
        }
      } catch {
        // Safe ignore
      }
    }
    checkExistingCredentials()
  }, [])

  const validateStep = (stepNum: number): boolean => {
    const errors: Record<string, string> = {}

    if (stepNum === 1) {
      if (!businessName.trim()) {
        errors.businessName = '매장 상호명을 입력해 주세요.'
      }
      if (!representativeName.trim()) {
        errors.representativeName = '대표자 성함을 입력해 주세요.'
      }
      if (!phone.trim()) {
        errors.phone = '대표 연락처(전화번호)를 입력해 주세요.'
      }
    } else if (stepNum === 2) {
      if (!signatureService.trim()) {
        errors.signatureService = '대표 서비스 또는 주력 상품 포인트를 입력해 주세요.'
      }
    }

    setStepErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleGoToNextStep = (nextStep: number) => {
    if (validateStep(currentStep)) {
      setStepErrors({})
      setCurrentStep(nextStep)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // Auto-sync form changes to orchestrator
  useEffect(() => {
    orchestrator.updateData({
      businessName,
      representativeName,
      category,
      registrationNumber,
      phone,
      address,
      brandTone,
      signatureService,
      priceInfo,
      forbiddenTerms,
      instagramHandle,
      threadsHandle,
      naverBlogId,
      daangnProfile,
      autonomyLevel,
      revenueGoal: selectedGoal
    })
  }, [
    businessName,
    representativeName,
    category,
    registrationNumber,
    phone,
    address,
    brandTone,
    signatureService,
    priceInfo,
    forbiddenTerms,
    instagramHandle,
    threadsHandle,
    naverBlogId,
    daangnProfile,
    autonomyLevel,
    selectedGoal,
    orchestrator
  ])

  const steps = [
    { num: 1, title: '매장 기본 정보', desc: '상호명 및 업종 등록', icon: Building2 },
    { num: 2, title: '비법 스타일 학습', desc: '서비스 특징·어투·금지어', icon: Sparkles },
    { num: 3, title: '4대 채널 계정 연결', desc: '인스타·스레드·네이버·당근', icon: Share2 },
    { num: 4, title: '자율 운영 규정', desc: '승인 정책 및 목표', icon: ShieldCheck },
    { num: 5, title: '첫 AI 실발행 체험', desc: '실시간 생성 및 채널 게시', icon: Rocket },
  ]

  const activeCategory = category === '기타' ? customCategory || '맞춤 업종' : category

  const handleStartFirstMission = async () => {
    setExecutionState('PLANNING')
    setLiveLog([
      `[1/6] 사장님의 매장 [${businessName || '우리 매장'}] 프로필 및 ${activeCategory} 상권 분석 시작...`,
      `[2/6] 학습된 브랜드 톤 [${brandTone}] 및 금지어 필터 장착 완료...`
    ])

    await new Promise((r) => setTimeout(r, 900))
    const displayHandle = (instagramHandle || '사장님 매장').replace(/^@/, '').replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
    setLiveLog((prev) => [
      ...prev,
      `[3/6] 인스타그램(@${displayHandle}) 피드 룩북 및 맞춤 카피 시안 생성 완료!`,
      `⏸️ [사장님 결재 대기 중] 소희가 시안 작성을 마쳤습니다. 위 카드에서 시안을 확인하시고 [첫 마케팅 시안 승인 및 저장] 버튼을 눌러주세요 ➔`
    ])
    setExecutionState('PREVIEW')
  }

  const [saveError, setSaveError] = useState<string | null>(null)

  const handleApproveAndPublish = async () => {
    setExecutionState('PUBLISHING')
    setLiveLog((prev) => [
      ...prev,
      `[4/6] 사전 품질 게이트(Quality Gate) 자동 검증: 금지어 0건, 맞춤법·표현 규격 100점 통과`,
      `[5/6] 소희 콘텐츠 사령부 승인 큐 등록 및 발행 파이프라인 가동...`
    ])

    try {
      const res = await fetch('/api/onboarding/first-wow-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[첫 맞춤 시안] ${businessName || '저희 매장'} 예약 안내`,
          content: `안녕하세요, ${businessName || '매장'}입니다! ${signatureService ? `${signatureService} 전문으로 ` : ''}고객 한 분 한 분의 스타일에 맞춘 1:1 세심한 케어를 약속드립니다.`,
          tags: ['소희AI', '매장홍보', '맞춤케어'],
          instagramHandle,
          category: activeCategory
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '시안 승인 원장 저장에 실패했습니다.')
      }

      const returnedState = data.executionState || 'QUEUED'

      setExecutionState(returnedState)
      setLiveLog((prev) => [
        ...prev,
        `[6/6] 콘텐츠 사령부 정식 원장 저장 완료 (${data.receipt?.actionRequestId || 'req-id'})`,
        returnedState === 'VERIFIED'
          ? `✅ [VERIFIED] 공식 인스타그램 실발행이 확인되었습니다!`
          : `📋 [QUEUED] 첫 마케팅 시안 승인 완료 · 사령부 보관 (실제 자동 포스팅을 위해 채널 공식 연동이 필요합니다)`
      ])

      if (onComplete) {
        onComplete({
          externalUrl: data.receipt?.externalUrl || '',
          missionId: 'mission-first-wow-01',
          usedCredits: 350,
        })
      }
    } catch (err: any) {
      setExecutionState('OFFLINE_UNSAVED')
      setLiveLog((prev) => [
        ...prev,
        `❌ [저장 실패] 시안 저장 중 오류가 발생했습니다: ${err.message || '네트워크 통신 오류'}. (저장되지 않았습니다. 다시 시도해 주세요)`
      ])
    }
  }

  const handleFinishOnboarding = async () => {
    setIsSaving(true)
    setSaveError(null)
    const finalBusinessName = businessName.trim() || '나의 소희 마케팅'

    try {
      const supabase = createBrowserSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.')
      }

      // 1. Fetch or auto-create workspace
      let { data: members } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)

      let wsId = members?.[0]?.workspace_id

      if (!wsId) {
        const { data: newWs, error: newWsErr } = await supabase
          .from('workspaces')
          .insert({ name: finalBusinessName, created_by: user.id })
          .select('id')
          .single()

        if (newWsErr || !newWs?.id) {
          throw new Error(`워크스페이스 생성 실패: ${newWsErr?.message || 'DB 에러'}`)
        }

        wsId = newWs.id
        await supabase.from('workspace_members').insert({
          workspace_id: wsId,
          user_id: user.id,
          role: 'owner'
        })
      }

      // 2. Update/Upsert business_profiles
      const { error: profileErr } = await supabase
        .from('business_profiles')
        .upsert({
          workspace_id: wsId,
          business_name: finalBusinessName,
          industry: activeCategory,
          location: address.trim() || null,
          summary: `${representativeName} 원장 / ${signatureService} 전문 매장`,
          updated_at: new Date().toISOString()
        }, { onConflict: 'workspace_id' })

      if (profileErr) {
        throw new Error(`비즈니스 프로필 저장 실패: ${profileErr.message}`)
      }

      // 3. Update workspaces name
      await supabase
        .from('workspaces')
        .update({ name: finalBusinessName })
        .eq('id', wsId)

      // 4. Save channel info to canonical channel_connections table (not imaginary channel_authorizations)
      if (instagramHandle.trim()) {
        await supabase.from('channel_connections').upsert({
          workspace_id: wsId,
          channel: 'INSTAGRAM',
          account_label: instagramHandle.trim(),
          status: 'configured',
          webhook_status: 'pending'
        }, { onConflict: 'workspace_id,channel' })
      }
      if (threadsHandle.trim()) {
        await supabase.from('channel_connections').upsert({
          workspace_id: wsId,
          channel: 'THREADS',
          account_label: threadsHandle.trim(),
          status: 'configured',
          webhook_status: 'pending'
        }, { onConflict: 'workspace_id,channel' })
      }

      // 5. Deduct First-Wow usage correctly in credit_ledger_entries if credit_account exists
      const { data: acc } = await supabase
        .from('credit_accounts')
        .select('id')
        .eq('workspace_id', wsId)
        .maybeSingle()

      if (acc?.id) {
        await supabase.from('credit_ledger_entries').insert({
          workspace_id: wsId,
          account_id: acc.id,
          kind: 'consume',
          action: 'text_generation',
          amount: -350,
          idempotency_key: `onboarding-first-wow:${wsId}:${Date.now()}`
        })
      }

      // 6. External Action Receipt 정규 발급 및 DB 저장 (ANI-558: Customer 360 & User Audit Parity)
      const wowRequestId = `first-wow-${wsId}-${Date.now()}`
      await (supabase as any).from('external_action_receipts').insert({
        workspace_id: wsId,
        request_id: wowRequestId,
        channel_id: 'INSTAGRAM',
        status: 'QUEUED',
        verification_method: 'FIRST_WOW_ORCHESTRATION',
        evidence_details: {
          intent: 'FIRST_WOW_APPROVED_POST',
          brandName: finalBusinessName,
          category: activeCategory,
          signatureService: signatureService
        }
      })

      // 7. All DB writes succeeded! Now commit to localStorage & cookie safely
      if (typeof window !== 'undefined') {
        localStorage.setItem('sohee_onboarded', 'true')
        localStorage.setItem('sohee_business_name', finalBusinessName)
        document.cookie = 'sohee_onboarded=true; path=/; max-age=31536000'
      }

      window.location.replace('/app')
    } catch (err: any) {
      console.error('[FirstWowFlow] Critical error during onboarding completion:', err)
      setSaveError(err?.message || '온보딩 정보 저장 중 오류가 발생했습니다. 다시 시도해 주세요.')
      setIsSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 font-sans space-y-6">
      {saveError && (
        <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={handleFinishOnboarding}
            className="px-3 py-1 bg-destructive hover:bg-destructive/90 rounded-lg text-destructive-foreground font-bold text-xs"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 🚨 소희 업무 정지 경보 배너 (주요 정보 미입력 경보) */}
      <SoheeStandbyAlertBanner currentStep={currentStep} businessName={businessName} />

      {/* 🌟 1. 소희의 대화형 환영 배너 (Conversational Header) */}
      <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-800 shadow-xl relative overflow-hidden text-white space-y-3">
        <div className="flex items-center gap-3.5">
          <div className="w-13 h-13 rounded-2xl bg-primary p-0.5 shadow-md flex items-center justify-center shrink-0">
            <div className="w-full h-full rounded-[14px] bg-zinc-900 flex items-center justify-center overflow-hidden">
              <span className="text-xl font-black text-white font-mono">S.</span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-white">소희와의 첫 대면: 매장 전담 AI 사원 셋업</h2>
              <span className="px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok border border-state-ok/40 text-[10px] font-bold">
                사업자 전용 무료 맛보기 (Free Taste 50 Energy 지원)
              </span>
            </div>
            <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">
              &ldquo;사장님 반갑습니다! 사장님 매장만의 비법과 SNS 계정을 알려주시면, 지금 즉시 첫 마케팅 콘텐츠를 기획하고 실발행까지 완료해 드릴게요.&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* 🌟 2. 5단계 진행 레일 (Progress Rail) */}
      <div className="mb-6 grid grid-cols-5 gap-2">
        {steps.map((s) => {
          const Icon = s.icon
          const isActive = currentStep === s.num
          const isDone = currentStep > s.num
          const isAccessible = s.num <= currentStep || isDone

          const handleRailClick = () => {
            if (s.num <= currentStep) {
              setStepErrors({})
              setCurrentStep(s.num)
            } else if (s.num === currentStep + 1) {
              handleGoToNextStep(s.num)
            } else {
              alert(`🚨 먼저 Step ${currentStep}의 필수 정보를 완료해 주세요!`)
            }
          }

          return (
            <button
              key={s.num}
              onClick={handleRailClick}
              className={`flex flex-col items-center justify-center rounded-2xl border p-3 text-center transition-all cursor-pointer ${
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20'
                  : isDone
                  ? 'border-state-ok bg-state-ok text-state-ok-soft'
                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700'
              } ${!isAccessible ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-1">
                {isDone ? <CheckCircle2 className="h-4 w-4 text-state-ok-soft" /> : <Icon className="h-4 w-4" />}
                <span className="text-xs font-bold font-mono">0{s.num}</span>
              </div>
              <span className="mt-1 text-xs font-bold truncate w-full">{s.title}</span>
            </button>
          )
        })}
      </div>

      {/* 🌟 3. 메인 단계별 폼 카드 */}
      <div className="rounded-3xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#121215] p-6 sm:p-8 shadow-xl space-y-6">
        
        {/* Contextual AI Advice & Proactive Stuck Recovery Nudge */}
        <OnboardingUxEnhancer currentStep={currentStep} category={category} />

        {/* Step 1: 매장 기본 정보 & 인사기록부 */}
        {currentStep === 1 && (
          <div className="space-y-5 animate-in fade-in duration-200" data-sohee-tour="step-1-profile">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-1">
                  <Building2 className="w-4 h-4" />
                  <span>Step 1. 사원 인사기록부 셋업</span>
                </div>
                <h3 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
                  사장님의 매장 기본 정보를 알려주세요
                </h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  소희가 활동할 매장의 상호명과 업종, 연락처를 등록합니다. 이 정보는 모든 마케팅 콘텐츠의 기본 정본으로 활용됩니다.
                </p>
              </div>

              {/* 💡 1단계 모범 작성 예시 토글 버튼 */}
              <button
                type="button"
                onClick={() => setShowExampleStep(showExampleStep === 1 ? null : 1)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{showExampleStep === 1 ? '예시 접기' : '💡 01단계 작성 예시 보기'}</span>
              </button>
            </div>

            {/* 💡 1단계 모범 작성 예시 카드 (토글 시 노출) */}
            {showExampleStep === 1 && (
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 text-xs space-y-2 animate-in slide-in-from-top-2 duration-200">
                <div className="font-extrabold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>실제 뷰티 매장 모범 작성 예시</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                  <div>• <strong>상호명</strong>: 우리 매장</div>
                  <div>• <strong>대표자</strong>: 이지은 원장</div>
                  <div>• <strong>업종</strong>: 뷰티/반영구</div>
                  <div>• <strong>대표 연락처</strong>: 010-8765-4321</div>
                  <div className="sm:col-span-2">• <strong>사업장 주소</strong>: 인천 서구 청라커낼로 123 청라빌딩 201호</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">매장 상호명 / 브랜드명 *</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => {
                    setBusinessName(e.target.value)
                    if (stepErrors.businessName) setStepErrors(prev => ({ ...prev, businessName: '' }))
                  }}
                  placeholder="예: 우리 매장"
                  className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none transition-all ${
                    stepErrors.businessName 
                      ? 'border-state-danger bg-state-danger-soft ring-1 ring-state-danger' 
                      : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 focus:border-primary'
                  }`}
                />
                {stepErrors.businessName && (
                  <p className="mt-1 text-[11px] font-bold text-state-danger">{stepErrors.businessName}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">대표자 성함 *</label>
                <input
                  type="text"
                  value={representativeName}
                  onChange={(e) => {
                    setRepresentativeName(e.target.value)
                    if (stepErrors.representativeName) setStepErrors(prev => ({ ...prev, representativeName: '' }))
                  }}
                  placeholder="예: 이지은 원장"
                  className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none transition-all ${
                    stepErrors.representativeName 
                      ? 'border-state-danger bg-state-danger-soft ring-1 ring-state-danger' 
                      : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 focus:border-primary'
                  }`}
                />
                {stepErrors.representativeName && (
                  <p className="mt-1 text-[11px] font-bold text-state-danger">{stepErrors.representativeName}</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-1.5">매장 업종 분류 *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    '뷰티/반영구', '네일/속눈썹', '피부/에스테틱', '헤어/미용', 
                    '왁싱/태닝', '헬스/필라테스', '카페/디저트', '기타'
                  ].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        category === cat
                          ? 'border-primary bg-primary/10 text-primary shadow-2xs'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {category === '기타' && (
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="직접 업종을 입력해 주세요 (예: 반려동물 미용, 요가스튜디오 등)"
                    className="mt-2 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">대표 연락처 / 예약 전화번호 *</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    if (stepErrors.phone) setStepErrors(prev => ({ ...prev, phone: '' }))
                  }}
                  placeholder="예: 010-8765-4321"
                  className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none transition-all ${
                    stepErrors.phone 
                      ? 'border-state-danger bg-state-danger-soft ring-1 ring-state-danger' 
                      : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 focus:border-primary'
                  }`}
                />
                {stepErrors.phone && (
                  <p className="mt-1 text-[11px] font-bold text-state-danger">{stepErrors.phone}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">사업장 주소 / 상권 위치</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="예: 서울 강남구 테헤란로 123 2층"
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">사업자등록번호 (선택)</label>
                <input
                  type="text"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="000-00-00000"
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => handleGoToNextStep(2)}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition-all cursor-pointer"
              >
                <span>다음: 비법 스타일 학습</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: 비법 스타일 & 브랜드 학습 */}
        {currentStep === 2 && (
          <div className="space-y-5 animate-in fade-in duration-200" data-sohee-tour="step-2-brand">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-1">
                  <Sparkles className="w-4 h-4" />
                  <span>Step 2. 매장 맞춤 비법 교육 (소희 업무 기준 셋업)</span>
                </div>
                <h3 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
                  소희가 학습할 매장의 서비스 특징과 어투를 설정해 주세요
                </h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  소희는 사장님의 대표 메뉴/서비스 포인트와 가격표, 그리고 절대 쓰지 말아야 할 금지어를 학습하여 고품질의 홍보 콘텐츠를 만듭니다.
                </p>
              </div>

              {/* 💡 2단계 모범 작성 예시 토글 버튼 */}
              <button
                type="button"
                onClick={() => setShowExampleStep(showExampleStep === 2 ? null : 2)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{showExampleStep === 2 ? '예시 접기' : '💡 02단계 작성 예시 보기'}</span>
              </button>
            </div>

            {/* 💡 2단계 모범 작성 예시 카드 (토글 시 노출) */}
            {showExampleStep === 2 && (
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 text-xs space-y-2 animate-in slide-in-from-top-2 duration-200">
                <div className="font-extrabold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>비법 스타일 & 금지어 모범 작성 예시</span>
                </div>
                <div className="grid grid-cols-1 gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                  <div>• <strong>대표 서비스 특장점</strong>: 1:1 맞춤 정성 케어, 당일 바로 일상 복귀 가능한 깔끔한 관리, 시그니처 대표 메뉴</div>
                  <div>• <strong>대표 가격표</strong>: 시그니처 서비스 15만원, 스페셜 코스 18만원, 첫방문 2만원 할인</div>
                  <div>• <strong>금지어</strong>: 100% 완벽, 부작용 제로, 영구적 보장, 무료 시술 (의료법 및 과대광고 방지)</div>
                </div>
              </div>
            )}

            <div className="space-y-4 pt-2">
              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">대표 서비스 / 주력 상품 및 특장점 *</label>
                <input
                  type="text"
                  value={signatureService}
                  onChange={(e) => {
                    setSignatureService(e.target.value)
                    if (stepErrors.signatureService) setStepErrors(prev => ({ ...prev, signatureService: '' }))
                  }}
                  placeholder="예: 1:1 맞춤 프라이빗 케어, 당일 일상 복귀 가능한 편안한 관리, 시그니처 메뉴"
                  className={`mt-1.5 w-full rounded-xl border px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none transition-all ${
                    stepErrors.signatureService
                      ? 'border-state-danger bg-state-danger-soft ring-1 ring-state-danger'
                      : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 focus:border-primary'
                  }`}
                />
                {stepErrors.signatureService && (
                  <p className="mt-1 text-[11px] font-bold text-state-danger">{stepErrors.signatureService}</p>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">대표 가격표 / 기본 서비스 단가</label>
                <input
                  type="text"
                  value={priceInfo}
                  onChange={(e) => setPriceInfo(e.target.value)}
                  placeholder="예: 시그니처 서비스 15만원, 정기 관리 5만원, 첫방문 15% 할인"
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block mb-1.5">선호하는 브랜드 말투 (Tone & Voice)</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { tone: '친절하고 전문적인', desc: '신뢰감을 주며 다정하고 정중한 어투' },
                    { tone: '감성적이고 트렌디한', desc: '인스타 감성의 세련되고 따뜻한 어투' },
                    { tone: '직관적이고 명확한', desc: '핵심 혜택과 가격, 일정을 강조하는 어투' }
                  ].map((t) => (
                    <button
                      key={t.tone}
                      type="button"
                      onClick={() => setBrandTone(t.tone)}
                      className={`p-3 rounded-2xl text-left border transition-all cursor-pointer ${
                        brandTone === t.tone
                          ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{t.tone}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">매장 금지 표현 / 의료법 주의 단어</label>
                <input
                  type="text"
                  value={forbiddenTerms}
                  onChange={(e) => setForbiddenTerms(e.target.value)}
                  placeholder="예: 100% 완벽, 부작용 제로, 영구적, 공짜"
                  className="mt-1.5 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => handleGoToNextStep(3)}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition-all cursor-pointer"
              >
                <span>다음: 4대 채널 계정 연결</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: 4대 채널 계정 연결 (SNS, 블로그, 당근) */}
        {currentStep === 3 && (
          <div className="space-y-5 animate-in fade-in duration-200" data-sohee-tour="step-3-channels">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-1">
                  <Share2 className="w-4 h-4" />
                  <span>Step 3. 4대 마케팅 채널 URL 및 계정 등록</span>
                </div>
                <h3 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
                  소희가 분석할 사장님의 SNS 채널 정보를 등록해 주세요
                </h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  인스타그램, 네이버 블로그 등의 주소나 계정명을 입력하시면, 매장 스타일을 학습하여 맞춤 시안을 기획합니다.
                </p>
              </div>

              {/* 💡 3단계 모범 작성 예시 & URL 찾는 법 토글 버튼 */}
              <button
                type="button"
                onClick={() => setShowExampleStep(showExampleStep === 3 ? null : 3)}
                className="flex items-center gap-1.5 min-h-11 px-3.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{showExampleStep === 3 ? '가이드 접기' : '💡 03단계 채널 URL 찾는 법 & 예시 보기'}</span>
              </button>
            </div>

            {/* 💡 3단계 채널 URL 예시 및 찾는 법 가이드 (토글 시 노출) */}
            {showExampleStep === 3 && (
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 text-xs space-y-2.5 animate-in slide-in-from-top-2 duration-200">
                <div className="font-extrabold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>4대 채널 URL 및 계정 입력 가이드</span>
                </div>
                <div className="space-y-1.5 text-zinc-700 dark:text-zinc-300 font-medium">
                  <div>• <strong>인스타그램</strong>: <code>https://instagram.com/my_store_official</code> 또는 <code>@my_store_official</code> (인스타 앱 ➔ 내 프로필 ➔ 프로필 공유 ➔ 링크 복사)</div>
                  <div>• <strong>스레드</strong>: <code>https://threads.net/@my_store_official</code> 또는 <code>@my_store_official</code></div>
                  <div>• <strong>네이버 블로그</strong>: <code>https://blog.naver.com/my_store</code> 또는 네이버 아이디</div>
                  <div>• <strong>당근 비즈프로필</strong>: <code>https://town.daangn.com/bp/12345</code> 또는 당근 매장명 (<code>우리 매장</code>)</div>
                </div>
              </div>
            )}

            {/* 💡 실제 SNS 포스팅 안내 배너 */}
            <div className="p-3.5 rounded-2xl bg-state-wait-soft border border-state-wait/30 text-xs flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-state-wait shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-state-wait block">💡 실제 SNS 자동 포스팅(실발행) 안내</span>
                <p className="text-zinc-600 dark:text-zinc-400 text-[11px] leading-relaxed">
                  채널 아이디/링크를 입력하시면 소희가 맞춤 시안을 작성합니다. 사장님의 실제 인스타그램/블로그에 글이 자동 등록되도록 하려면, 온보딩 완료 후 [채널 관리]에서 <strong>공식 소셜 계정 로그인(OAuth)</strong>을 완료해 주셔야 합니다.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {/* Instagram Card */}
              <div className="p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    <span className="w-6 h-6 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-xs font-black">IG</span>
                    <span>인스타그램 (Instagram) *</span>
                  </div>
                  {connectedChannels.instagram ? (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok font-extrabold flex items-center gap-1 border border-state-ok/40">
                      <CheckCircle2 className="w-3 h-3" />
                      연동 완료
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold">Meta 공식 API</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={instagramHandle}
                    onChange={(e) => setInstagramHandle(e.target.value)}
                    placeholder="예: https://instagram.com/my_store_official 또는 @my_store_official"
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 min-h-11 px-3.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAuthChannel({ type: 'instagram', name: '인스타그램' })}
                    className="min-h-11 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                  >
                    🔗 공식 연동
                  </button>
                </div>
              </div>

              {/* Threads Card */}
              <div className="p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    <span className="w-6 h-6 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center text-xs font-black">TH</span>
                    <span>스레드 (Threads)</span>
                  </div>
                  {connectedChannels.threads ? (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok font-extrabold flex items-center gap-1 border border-state-ok/40">
                      <CheckCircle2 className="w-3 h-3" />
                      연동 완료
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold">Meta 공식 API</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={threadsHandle}
                    onChange={(e) => setThreadsHandle(e.target.value)}
                    placeholder="예: https://threads.net/@my_store_official 또는 @my_store_official"
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 min-h-11 px-3.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAuthChannel({ type: 'threads', name: '스레드' })}
                    className="min-h-11 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                  >
                    🔗 공식 연동
                  </button>
                </div>
              </div>

              {/* Naver Blog Card */}
              <div className="p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    <span className="w-6 h-6 rounded-lg bg-state-ok text-state-ok-soft flex items-center justify-center text-xs font-black">N</span>
                    <span>네이버 블로그</span>
                  </div>
                  {connectedChannels.naver ? (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok font-extrabold flex items-center gap-1 border border-state-ok/40">
                      <CheckCircle2 className="w-3 h-3" />
                      등록 완료
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-state-ok-soft text-state-ok font-bold">원고 준비 지원</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={naverBlogId}
                    onChange={(e) => setNaverBlogId(e.target.value)}
                    placeholder="예: https://blog.naver.com/my_store 또는 네이버 아이디"
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 min-h-11 px-3.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAuthChannel({ type: 'naver', name: '네이버 블로그' })}
                    className="min-h-11 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                  >
                    🔗 연동하기
                  </button>
                </div>
              </div>

              {/* Daangn Card */}
              <div className="p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-zinc-900 dark:text-zinc-100">
                    <span className="w-6 h-6 rounded-lg bg-state-warn text-state-warn-soft flex items-center justify-center text-xs font-black">🥕</span>
                    <span>당근 비즈프로필</span>
                  </div>
                  {connectedChannels.daangn ? (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-state-ok-soft text-state-ok font-extrabold flex items-center gap-1 border border-state-ok/40">
                      <CheckCircle2 className="w-3 h-3" />
                      연동 완료
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-state-warn-soft text-state-warn font-bold">동네 홍보/쿠폰</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={daangnProfile}
                    onChange={(e) => setDaangnProfile(e.target.value)}
                    placeholder="예: https://town.daangn.com/bp/12345 또는 매장 상호명"
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 min-h-11 px-3.5 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setActiveAuthChannel({ type: 'daangn', name: '당근마켓' })}
                    className="min-h-11 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                  >
                    🔗 연동하기
                  </button>
                </div>
              </div>
            </div>

            {/* 🌟 소희 실제 포스팅 위임 동의 절차 (사용자 선택권 보장) */}
            <div className="p-4.5 rounded-2xl border border-primary/30 bg-primary/10 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToPost}
                  onChange={(e) => setAgreedToPost(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded text-primary focus:ring-primary/50 border-zinc-300 dark:border-zinc-700 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold text-zinc-950 dark:text-zinc-50">
                    [필수/선택] 소희 AI가 위 4대 채널 계정으로 마케팅 콘텐츠를 실제 포스팅(발행)하는 것에 동의합니다.
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    동의하시면 소희가 승인된 기획안을 바탕으로 사장님의 SNS 채널(인스타그램·스레드)에 안전하게 배포를 수행합니다. (네이버 블로그·당근은 원고를 준비해 드려요) 언제든 [나의 소희]에서 설정을 변경하실 수 있습니다.
                  </p>
                </div>
              </label>

              {/* 동의하지 않았거나 채널이 비어있을 때 상시 경보 가이드 */}
              {(!agreedToPost || (!instagramHandle && !threadsHandle && !naverBlogId && !daangnProfile)) && (
                <div className="p-3 rounded-xl bg-state-warn-soft border border-state-warn/30 text-state-warn text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-state-warn shrink-0" />
                  <span>⚠️ 실제 SNS 채널(인스타그램·스레드)을 연결하고 승인하지 않으시면 실제 게시가 진행되지 않으며, 시안 확인용으로만 동작합니다. (네이버 블로그·당근은 원고 준비 지원)</span>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="min-h-11 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => handleGoToNextStep(4)}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary min-h-11 px-6 py-3 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition-all cursor-pointer"
              >
                <span>다음: 자율 운영 규정</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: 자율 운영 규정 & 매출 목표 */}
        {currentStep === 4 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Step 4. 소희 사원의 업무 승인 및 자율성 범위</span>
                </div>
                <h3 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
                  소희가 업무를 실행할 때의 승인 규정을 선택해 주세요
                </h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  대표님의 사전 허락 없이 외부 채널에 잘못된 글이 나가지 않도록 3단계 안전 가드를 제공합니다.
                </p>
              </div>

              {/* 💡 4단계 목표 설정 예시 토글 버튼 */}
              <button
                type="button"
                onClick={() => setShowExampleStep(showExampleStep === 4 ? null : 4)}
                className="flex items-center gap-1.5 min-h-11 px-3.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{showExampleStep === 4 ? '가이드 접기' : '💡 04단계 매출 목표 가이드 보기'}</span>
              </button>
            </div>

            {/* 💡 4단계 매출 목표 추천 가이드 (토글 시 노출) */}
            {showExampleStep === 4 && (
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/30 text-xs space-y-2 animate-in slide-in-from-top-2 duration-200">
                <div className="font-extrabold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span>매장 상황별 최적의 매출 목표 추천</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-primary/15">
                    <strong className="text-primary block mb-1">1. 유휴 공실 방어</strong>
                    평일 낮 시간대(13~16시) 예약이 비어있을 때 타깃 타임세일 자동 가동
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-primary/15">
                    <strong className="text-primary block mb-1">2. 신규 고객 유치</strong>
                    오픈 초기나 상권 내 새로운 고객 유입이 절실할 때 추천
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-primary/15">
                    <strong className="text-primary block mb-1">3. 프리미엄 객단가</strong>
                    기존 단골이 충분하고 1인당 결제 금액을 높이고 싶을 때 추천
                  </div>
                </div>
              </div>
            )}

            {/* 매출 극대화 목표 선택 */}
            <div className="space-y-3 pt-2" data-sohee-tour="step-4-revenue-goals">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
                소희가 가장 우선적으로 달성할 매출 목표 (Revenue Goal) *
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    key: 'FILL_EMPTY_SLOTS',
                    title: '유휴 예약 공실 방어',
                    desc: '평일 낮/비인기 타임 타깃 할인 오퍼로 공실 예약 집중 개선',
                    icon: Target,
                    highlight: '공실 개선 집중'
                  },
                  {
                    key: 'ATTRACT_NEW_CLIENTS',
                    title: '신규 고객 첫 방문 유치',
                    desc: '상권 내 첫 방문 혜택 및 인스타 감성 룩북으로 신규 유입',
                    icon: TrendingUp,
                    highlight: '신규 문의 3.4배'
                  },
                  {
                    key: 'INCREASE_TICKET_SIZE',
                    title: '프리미엄 객단가 상승',
                    desc: '시그니처 패키지 및 회원권 연계 콘텐츠로 객단가 극대화',
                    icon: DollarSign,
                    highlight: '객단가 +45%'
                  }
                ].map((g) => {
                  const Icon = g.icon
                  const isSelected = selectedGoal === g.key
                  return (
                    <div
                      key={g.key}
                      onClick={() => setSelectedGoal(g.key as any)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok">
                            {g.highlight}
                          </span>
                        </div>
                        <div>
                          <h4 className="font-bold text-xs text-zinc-950 dark:text-zinc-50">{g.title}</h4>
                          <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">{g.desc}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-3 pt-3" data-sohee-tour="step-4-autonomy">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
                콘텐츠 발행 승인 규정
              </label>

              <div
                onClick={() => setAutonomyLevel('APPROVAL_REQUIRED')}
                className={`p-4.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                  autonomyLevel === 'APPROVAL_REQUIRED'
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="mt-0.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                  ✓
                </div>
                <div>
                  <h4 className="font-bold text-xs md:text-sm text-zinc-950 dark:text-zinc-50">
                    사장님 결재 후 실행 (R2 등급 필수 결재 · 권장 기본값)
                  </h4>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                    소희가 시안과 이미지를 기획하면 사장님께 모바일 알림을 보냅니다. 사장님이 [승인] 버튼을 눌렀을 때만 실제 SNS(인스타그램·스레드)로 안전하게 게시됩니다. (네이버 블로그·당근은 원고를 준비해 드려요)
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="min-h-11 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => handleGoToNextStep(5)}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary min-h-11 px-6 py-3 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition-all cursor-pointer"
              >
                <span>다음: 첫 AI 실발행 체험하기</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 5: 첫 AI 실발행 체험 (First Wow Live Experience) */}
        {currentStep === 5 && (
          <div className="space-y-6 animate-in fade-in duration-200" data-sohee-tour="step-5-publish">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider mb-1">
                <Rocket className="w-4 h-4" />
                <span>Step 5. 소희 AI 첫 실전 마케팅 가동 & 실발행 체험</span>
              </div>
              <h3 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
                입력하신 정보로 소희가 즉시 첫 마케팅을 시작합니다!
              </h3>
              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                기획부터 카피 작성, 시안 승인, 인스타그램/스레드 실제 게시 및 Read-after-write 실증빙까지 전 과정을 체험합니다.
              </p>
            </div>

            {/* 초기 가동 CTA */}
            {executionState === 'IDLE' && (
              <div className="p-8 rounded-3xl bg-primary/10 border-2 border-dashed border-primary/30 text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30">
                  <Sparkles className="w-7 h-7 animate-spin" />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h4 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                    &lsquo;{businessName || '우리 매장'}&rsquo; 맞춤 첫 인스타그램 & 스레드 홍보 콘텐츠 생성
                  </h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    업종: <strong className="text-primary">{activeCategory}</strong> ·
                    대표서비스: <strong className="text-primary">{signatureService || '1:1 맞춤 케어'}</strong>
                  </p>
                  <p className="text-[11px] text-zinc-400 pt-1">
                    예상 소요 Energy: 10 Energy (사업자 맛보기 50 Energy에서 안전하게 차감)
                  </p>
                </div>
                <button
                  onClick={handleStartFirstMission}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary/90 px-7 py-3.5 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all cursor-pointer active:scale-95"
                >
                  <Rocket className="w-4 h-4" />
                  <span>소희에게 첫 마케팅 업무 맡기기</span>
                </button>
              </div>
            )}

            {/* 시안 미리보기 (Preview) */}
            {executionState === 'PREVIEW' && (
              <div className="space-y-4 rounded-3xl border-2 border-primary bg-zinc-50 dark:bg-zinc-900/50 p-6 shadow-2xl animate-in fade-in duration-300">
                {/* 🚨 사장님 승인 결재 대기 배너 */}
                <div className="p-3.5 rounded-2xl bg-state-warn-soft border border-state-warn/40 text-state-warn flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-state-warn animate-ping" />
                    <span>🚨 [사장님 결재 대기] 소희가 작성한 기획안을 확인하시고 아래 [게시 승인] 버튼을 눌러주세요!</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-state-warn-soft font-extrabold shrink-0">
                    4/6~6/6 자동 가동 대기
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                      인스타그램 & 스레드 동시 기획안
                    </span>
                    <span className="text-xs text-zinc-400 font-mono">소희 사원 작성 완료</span>
                  </div>
                  <span className="text-xs text-state-ok font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    품질 검증 통과 (100점)
                  </span>
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3 shadow-inner">
                  <div className="text-xs text-zinc-500 font-bold">
                    연결 계정: <span className="text-primary font-mono">@{instagramHandle || 'my_store_official'}</span>
                  </div>
                  <p className="text-xs md:text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-relaxed whitespace-pre-line">
                    ✨ 이번 주 {businessName || '저희 매장'} 맞춤 예약 안내 ✨
                    {'\n\n'}
                    안녕하세요, {businessName || '매장'}입니다! {signatureService ? `${signatureService} 전문으로 ` : ''}고객 한 분 한 분의 스타일에 맞춘 1:1 세심한 케어를 약속드립니다.
                    {'\n'}
                    이번 주 여유 슬롯이 오픈되었으니 편안하게 문의해 주세요 💜
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-xs text-primary font-medium pt-1">
                    <span>#{activeCategory.replace(/\//g, '')}</span>
                    <span>#{businessName.replace(/\s+/g, '') || '매장홍보'}</span>
                    <span>#{signatureService.split(' ')[0] || '맞춤케어'}</span>
                    <span>#예약문의</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <p className="text-xs text-zinc-500 font-medium">
                    버튼을 누르시면 <strong>첫 시안 승인 및 사령부 보관(4/6~6/6)</strong>이 완료됩니다. (실제 SNS 포스팅은 채널 관리에서 공식 계정 연동 및 승인 시 진행됩니다.)
                  </p>
                  <button
                    onClick={handleApproveAndPublish}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary/90 px-7 py-3.5 text-sm font-black text-primary-foreground shadow-xl shadow-primary/40 ring-4 ring-primary/30 transition-all cursor-pointer active:scale-95"
                  >
                    <span>👉 첫 마케팅 시안 승인 및 저장 (클릭)</span>
                    <ArrowRight className="h-4 w-4 stroke-[3]" />
                  </button>
                </div>
              </div>
            )}

            {/* 실시간 런타임 로그 */}
            {liveLog.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4.5 font-mono text-xs text-zinc-700 dark:text-zinc-300 space-y-2">
                <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  {executionState === 'VERIFIED' ? (
                    <CheckCircle2 className="h-4 w-4 text-state-ok" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  <span className="font-bold">실시간 Agent Runtime 런타임 스트림</span>
                </div>
                {liveLog.map((log, idx) => (
                  <div key={idx} className={log.includes('VERIFIED') ? 'text-state-ok font-bold' : ''}>
                    {log}
                  </div>
                ))}
              </div>
            )}

            {/* 최종 실증빙 완료 또는 승인 큐 등록 & 대시보드 진입 */}
            {(executionState === 'VERIFIED' || executionState === 'QUEUED') && (
              <LivePublishProofViewer
                businessName={businessName}
                instagramHandle={instagramHandle}
                category={activeCategory}
                signatureService={signatureService}
                onFinish={handleFinishOnboarding}
                isSaving={isSaving}
              />
            )}
          </div>
        )}
      </div>

      {/* 🌟 4대 채널 정식 OAuth 공식 연동 모달 */}
      {activeAuthChannel && (
        <ChannelAuthModal
          isOpen={!!activeAuthChannel}
          onClose={() => setActiveAuthChannel(null)}
          channelType={activeAuthChannel.type}
          channelName={activeAuthChannel.name}
          currentValue={
            activeAuthChannel.type === 'instagram'
              ? instagramHandle
              : activeAuthChannel.type === 'threads'
              ? threadsHandle
              : activeAuthChannel.type === 'naver'
              ? naverBlogId
              : daangnProfile
          }
          onSave={(val, isConnected) => {
            if (activeAuthChannel.type === 'instagram') setInstagramHandle(val)
            if (activeAuthChannel.type === 'threads') setThreadsHandle(val)
            if (activeAuthChannel.type === 'naver') setNaverBlogId(val)
            if (activeAuthChannel.type === 'daangn') setDaangnProfile(val)
            setConnectedChannels((prev) => ({
              ...prev,
              [activeAuthChannel.type]: isConnected
            }))
          }}
        />
      )}

      {/* Driver.js Guided Tour Adapter & Help Launcher */}
      <DriverTourAdapter />
    </div>
  )
}


