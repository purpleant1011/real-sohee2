'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AtSign, Check, CheckCircle2, ChevronLeft, Loader2, MessageCircle, Sparkles, Store } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { TONE_PRESETS, type TonePresetKey } from '@/features/quick-start/tone-presets'
import { ChannelConnectNotice } from '@/features/channels/ui/channel-connect-notice'
import { getConnectNotice } from '@/features/channels/ui/channel-display'
import { EMPTY_BUSINESS_DETAILS, type BusinessDetailsInput } from '@/features/quick-start/business-details'
import { BusinessVerificationStep } from './business-verification-step'
import { MediaUploadCard } from '@/features/media/media-upload-card'
import { BusinessDetailsSection, hasAnyDetailValue, shouldSubmitDetails } from './business-details-section'

const INDUSTRIES = [
  { label: '카페·디저트', hint: '예: 직접 로스팅한 원두와 수제 디저트를 파는 동네 카페' },
  { label: '식당·음식점', hint: '예: 매일 아침 만드는 손칼국수와 수육 전문 식당' },
  { label: '미용·네일·뷰티', hint: '예: 1:1 맞춤 상담으로 시술하는 프라이빗 네일숍' },
  { label: '학원·교육', hint: '예: 초등 저학년 대상 소수정예 수학·영어 공부방' },
  { label: '쇼핑·판매', hint: '예: 직접 만든 수제 비누와 향초를 파는 온라인 스토어' },
  { label: '병원·클리닉', hint: '예: 지역 주민의 건강을 살피는 가정의학과 의원' },
  { label: '운동·건강', hint: '예: 소규모 그룹 수업 중심의 필라테스 스튜디오' },
  { label: '기타', hint: '예: 우리 가게를 한 줄로 소개해 주세요' },
] as const

type Step = 'shop' | 'tone' | 'channels' | 'business'
const STEPS = [
  { key: 'shop', title: '우리 가게' },
  { key: 'tone', title: '소희 말투' },
  { key: 'channels', title: '계정 연결' },
  { key: 'preview', title: '첫 글 미리보기 & 발행' },
] as const

interface ReadyState {
  workspaceId?: string
  facts: Record<string, boolean>
  profile: { business_name?: string; industry?: string; location?: string; summary?: string } | null
  creditNotice?: string
  preferences?: { goal: string; tone: TonePresetKey }
  businessDetails?: BusinessDetailsInput | null
  ready: boolean
  stage: 'PREPARE_ONLY' | 'PUBLISH_READY'
  progressPercent: number
  connectionHint: string | null
}

export function StartWizard() {
  const router = useRouter()
  const search = useSearchParams()
  const [step, setStep] = useState<Step>('shop')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [state, setState] = useState<ReadyState | null>(null)
  const initializedRef = useRef(false)
  const appliedStepQueryRef = useRef<string | null>(null)
  const autoAdvancedRef = useRef(false)
  const autoAdvanceTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) window.clearTimeout(autoAdvanceTimerRef.current)
    }
  }, [])

  const [businessName, setBusinessName] = useState('')
  const [industry, setIndustry] = useState<string>('')
  const [location, setLocation] = useState('')
  const [summary, setSummary] = useState('')
  const [tone, setTone] = useState<TonePresetKey>('friendly')
  const [goal, setGoal] = useState('')
  const [progressNotice, setProgressNotice] = useState<string | null>(null)
  const savedShop = useRef('')
  const latestShop = useRef('')
  const progressQueue = useRef<Promise<void>>(Promise.resolve())
  const [businessDetails, setBusinessDetails] = useState<BusinessDetailsInput>({ ...EMPTY_BUSINESS_DETAILS })
  const patchBusinessDetails = useCallback((patch: Partial<BusinessDetailsInput>) => {
    setBusinessDetails((prev) => ({ ...prev, ...patch }))
  }, [])

  const refresh = useCallback(async () => {
    const res = await fetch('/api/onboarding/quick-start', { cache: 'no-store' })
    if (!res.ok) throw new Error('상태를 불러오지 못했어요.')
    const data = (await res.json()) as ReadyState
    setState(data)
    return data
  }, [])

  useEffect(() => {
    Promise.all([
      refresh(),
      fetch('/api/auth/business-verification', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ])
      .then(([data]) => {
        if (data.profile?.business_name && data.profile.business_name !== '신규 매장') {
          setBusinessName(data.profile.business_name)
          setIndustry(data.profile.industry ?? '')
          setLocation(data.profile.location ?? '')
          setSummary(data.profile.summary ?? '')
          savedShop.current = JSON.stringify({ businessName: data.profile.business_name, industry: data.profile.industry ?? '', location: data.profile.location ?? '', summary: data.profile.summary ?? '' })
        }
        if (data.preferences) {
          setGoal(data.preferences.goal)
          setTone(data.preferences.tone)
        }
        // 사장님이 이전에 직접 입력한 사업자·운영 정보가 있으면 그대로 복원한다.
        if (data.businessDetails) {
          setBusinessDetails((prev) => ({ ...prev, ...data.businessDetails }))
        }
        const stepQuery = search?.get('step') as Step | null
        const connectQuery = search?.get('connect') || search?.get('status')
        const errorQuery = search?.get('error')

        const validStepQuery =
          stepQuery && (STEPS.some((s) => s.key === stepQuery) || stepQuery === 'channels' || stepQuery === 'business')

        if (validStepQuery && appliedStepQueryRef.current !== stepQuery) {
          // 딥링크(?step=...)는 URL이 바뀔 때만 적용한다. 같은 쿼리로 재실행될 때
          // 사용자가 화면 안에서 이동한 단계를 되돌리지 않기 위해서다.
          appliedStepQueryRef.current = stepQuery
          initializedRef.current = true
          setStep(stepQuery)
        } else if (!initializedRef.current) {
          if (connectQuery || errorQuery) {
            setStep('channels')
          } else {
            setStep('shop')
          }
          initializedRef.current = true
        }
      })
      .catch(() => {
        if (!initializedRef.current) {
          setStep('shop')
          initializedRef.current = true
        }
        toast.error('상태를 불러오지 못했어요. 새로고침해 주세요.')
      })
      .finally(() => setLoading(false))
    const connect = search?.get('connect') || search?.get('status')
    const errorParam = search?.get('error')
    const channelParam = search?.get('channel')?.toLowerCase()
    const accountParam = search?.get('account')
    if (connect === 'forbidden') {
      toast.error('채널은 매장 대표 계정으로만 연결할 수 있어요.')
    } else if (connect === 'unavailable' && !errorParam) {
      toast.error('지금은 연결을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.')
    } else if (connect === 'authorized' || connect === 'connected') {
      const channelName = channelParam === 'instagram' ? '인스타그램' : channelParam === 'threads' ? '스레드' : '채널'
      const label = accountParam ? `${channelName}(@${accountParam})` : channelName
      toast.success(`${label} 계정이 연결되었어요.`)
      // 연결을 마치고 돌아온 사장님은 다시 버튼을 찾지 않도록 첫 글 화면으로 이어준다.
      // 성공 안내를 읽을 시간을 주되, 스스로 멈춰 서지 않도록 2초 뒤 이동한다.
      if (!autoAdvancedRef.current) {
        autoAdvancedRef.current = true
        autoAdvanceTimerRef.current = window.setTimeout(() => router.push('/start/preview'), 2000)
      }

    }
  }, [refresh, search, router])

  useEffect(() => {
    const workspaceId = state?.workspaceId
    if (loading || saving || !workspaceId || !businessName.trim()) return
    const body = JSON.stringify({ businessName, industry, location, summary })
    latestShop.current = body
    if (savedShop.current === body) return
    const timer = setTimeout(() => {
      setProgressNotice('가게 정보 저장 중…')
      // Serialize writes so an earlier slow response cannot overwrite later input.
      progressQueue.current = progressQueue.current.then(async () => {
        const response = await fetch('/api/onboarding/quick-start', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId }, body,
        })
        if (!response.ok) throw new Error('save failed')
        savedShop.current = body
        if (latestShop.current === body) setProgressNotice('입력한 가게 정보를 저장했어요.')
      }).catch(() => setProgressNotice('가게 정보를 저장하지 못했어요. 이 화면에서 내용을 다시 확인해 주세요.'))
    }, 800)
    return () => clearTimeout(timer)
  }, [loading, saving, state?.workspaceId, businessName, industry, location, summary])

  const hint = useMemo(() => INDUSTRIES.find((i) => i.label === industry)?.hint ?? INDUSTRIES[7].hint, [industry])
  const shopValid = businessName.trim() && industry.trim() && summary.trim()

  // 'business' 는 4단계 흐름 밖의 보조 화면이므로 계정 연결 단계(3번째)의 하위 단계로 취급한다.
  const stepIndex = useMemo(() => {
    const key = step === 'business' ? 'channels' : step
    return STEPS.findIndex((s) => s.key === key)
  }, [step])
  const progressPercent = Math.round(((stepIndex + 1) / STEPS.length) * 100)

  const queryConnect = search?.get('connect') || search?.get('status')
  const queryError = search?.get('error')
  const queryConnectError = search?.get('connect_error')
  const queryChannel = search?.get('channel')?.toLowerCase()
  const isAuthorized = queryConnect === 'authorized' || queryConnect === 'connected'
  const queryIgConnected = isAuthorized && queryChannel === 'instagram'
  const queryThConnected = isAuthorized && queryChannel === 'threads'

  const channelNotice = useMemo(() => {
    return getConnectNotice(queryConnect || queryError || null, queryConnectError || queryError || null, {
      channel: queryChannel,
      returnPath: '/start?step=channels',
    })
  }, [queryConnect, queryError, queryConnectError, queryChannel])

  const igConnected = Boolean(state?.facts.INSTAGRAM_VERIFIED || queryIgConnected)
  const thConnected = Boolean(state?.facts.THREADS_VERIFIED || queryThConnected)
  const anyChannel = igConnected || thConnected

  async function saveAndContinue() {
    setSaving(true)
    try {
      await progressQueue.current
      const res = await fetch('/api/onboarding/quick-start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName,
          industry,
          location,
          summary,
          tone,
          goal,
          // 사업자·운영 정보는 전부 선택 항목이라, 하나도 안 적었으면 보내지 않는다.
          ...(shouldSubmitDetails(businessDetails) ? { businessDetails } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '저장하지 못했어요.')
      await refresh()
      // 채널 연결 단계로 이어간다. 건너뛰려는 사장님은 이 화면에서 바로 미리보기로 갈 수 있다.
      setStep('channels')
      router.push('/start?step=channels')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">불러오는 중</span>
      </div>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8 sm:py-14">
      <header className="mb-8 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/start/start-hero.jpg"
          alt="소희와 함께 10분 만에 첫 마케팅 게시물 만들기"
          width={720}
          height={720}
          className="h-36 w-full rounded-2xl object-cover object-[50%_35%] sm:h-44"
        />
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="size-4" aria-hidden /> 소희와 함께 시작하기
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          10분 안에 첫 게시물까지,
          <br className="sm:hidden" /> 소희가 같이 할게요
        </h1>
        <nav aria-label="시작 단계 진행 순서" className="space-y-2">
          <Progress value={progressPercent} aria-label="준비 진행률" />
          <ol className="flex justify-between gap-1 text-xs text-muted-foreground">
            {STEPS.map((s, i) => {
              const isCurrent = i === stepIndex
              const isPast = i < stepIndex
              return (
                <li
                  key={s.key}
                  className={cn('flex items-center gap-1.5', (isCurrent || isPast) && 'font-semibold text-foreground')}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded-full border text-[11px]',
                      isPast && 'border-primary bg-primary text-primary-foreground',
                      isCurrent && 'border-primary text-primary font-bold',
                    )}
                    aria-hidden="true"
                  >
                    {isPast ? <Check className="size-3" aria-hidden /> : i + 1}
                  </span>
                  <span>{s.title}</span>
                  {isCurrent && <span className="sr-only">(현재 단계)</span>}
                  {isPast && <span className="sr-only">(완료)</span>}
                </li>
              )
            })}
          </ol>
        </nav>
      </header>

      {!anyChannel && (
        <aside className="mb-6 rounded-lg border bg-muted/40 p-4 text-sm" aria-label="시작 안내">
          <p>SNS 1곳 연결 시 첫 포스팅 무료 혜택이 제공돼요. 사진 저장과 가게 정보 입력은 먼저 할 수 있어요.</p>
          <Button variant="link" className="min-h-11 h-auto whitespace-normal px-0 text-left" onClick={() => setStep('channels')}>
            채널 연결하러 가기
          </Button>
        </aside>
      )}

      {step === 'business' && (
        <div className="space-y-4">
          <BusinessVerificationStep
            onSubmitted={async () => {
              await refresh().catch(() => undefined)
              setStep('channels')
              router.push('/start?step=channels')
            }}
          />
          <div className="flex flex-col items-center gap-2 pt-2">
            <Button
              variant="outline"
              className="h-11 min-h-[44px] w-full sm:w-auto"
              onClick={() => {
                setStep('channels')
                router.push('/start?step=channels')
              }}
            >
              <ChevronLeft aria-hidden /> 계정 연결로 돌아가기
            </Button>
            <Button
              variant="link"
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4"
              onClick={() => router.push('/start/preview')}
            >
              서류가 당장 없으신가요? 첫 글 먼저 확인하고 나중에 인증하기 ➡️
            </Button>
          </div>
        </div>
      )}

      {step === 'shop' && (
        <Card className="border-2 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <Store className="size-5 text-primary" aria-hidden /> 어떤 가게인가요?
            </CardTitle>
            <CardDescription className="text-sm">소희가 글과 사진을 만들 때 기준이 돼요. 나중에 언제든 바꿀 수 있어요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">
              가게 이름·업종·소개만 있으면 시작할 수 있어요. 나머지는 아래에서 채우시면 소희가 더 정확하게 써요.
            </p>

            <div className="space-y-2">
              <Label htmlFor="biz-name" className="font-bold">가게 이름</Label>
              <Input id="biz-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="예: 모모 카페" maxLength={60} autoFocus className="h-11" />
            </div>
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-bold">업종</legend>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    onClick={() => setIndustry(i.label)}
                    aria-pressed={industry === i.label}
                    className={cn(
                      'rounded-full border px-4 py-2 text-xs sm:text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px] inline-flex items-center justify-center font-medium',
                      industry === i.label ? 'border-primary bg-primary text-primary-foreground font-bold shadow-xs' : 'bg-background hover:bg-accent border-border',
                    )}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="biz-location" className="font-bold">
                위치 <span className="font-normal text-muted-foreground">(선택)</span>
              </Label>
              <Input id="biz-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="예: 성수동, 홍대입구역 근처" maxLength={60} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-summary" className="font-bold">우리 가게를 한두 문장으로 소개해 주세요</Label>
              <Textarea id="biz-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={hint} rows={4} maxLength={300} className="resize-none" />
              <p className="text-right text-xs text-muted-foreground">{summary.length}/300</p>
            </div>
            {progressNotice && <p role="status" className="text-sm text-muted-foreground">{progressNotice}</p>}
            <div className="space-y-2">
              <Label htmlFor="first-goal">이번 주 알리고 싶은 것 (선택)</Label>
              <Textarea id="first-goal" value={goal} onChange={e => setGoal(e.target.value)} rows={2} maxLength={300} placeholder="예: 이번 주 새 메뉴를 알리고 싶어요" />
              <p className="text-xs text-muted-foreground">목표는 사실 정보와 따로 저장해요. 첫 글 만들기를 누르면 저장돼요. 비워 두어도 괜찮아요.</p>
            </div>
            {state?.workspaceId && <MediaUploadCard key={state.workspaceId} workspaceId={state.workspaceId} />}

            <BusinessDetailsSection
              value={businessDetails}
              onChange={patchBusinessDetails}
              defaultOpen={hasAnyDetailValue(businessDetails)}
            />

            <Button className="h-12 min-h-[48px] w-full text-base font-bold shadow-sm" disabled={!shopValid} onClick={() => setStep('tone')}>
              다음: 소희 말투 고르기 ➡️
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'tone' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="size-5 text-primary" aria-hidden /> 소희가 어떤 말투로 쓸까요?
            </CardTitle>
            <CardDescription>마음에 드는 말투를 골라 주세요. 게시물마다 다시 다듬을 수 있어요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div role="radiogroup" aria-label="말투 선택" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TONE_PRESETS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={tone === t.key}
                  onClick={() => setTone(t.key)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col justify-between',
                    tone === t.key ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-xs' : 'bg-background hover:bg-accent/40',
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-sm text-foreground">{t.label}</span>
                      {tone === t.key ? (
                        <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" aria-hidden />
                        </span>
                      ) : (
                        <span className="size-5 rounded-full border border-muted-foreground/30" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-snug">{t.description}</p>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/60 p-2.5 text-xs text-foreground/90 leading-relaxed font-sans border border-border/50">
                    “{t.sample}”
                  </div>
                </button>
              ))}
            </div>
            {state?.creditNotice && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{state.creditNotice}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="h-11 min-h-[44px] min-w-[44px] px-4" onClick={() => setStep('shop')}>
                <ChevronLeft aria-hidden /> 이전
              </Button>
              <Button className="h-11 min-h-[44px] flex-1 font-bold" onClick={saveAndContinue} disabled={saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden />} 소희 첫 글 만들기 ➡️
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'channels' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AtSign className="size-5 text-primary" aria-hidden /> 게시물을 올릴 계정을 연결해 주세요
            </CardTitle>
            <CardDescription>
              하나만 연결해도 시작할 수 있고, 두 곳을 연결하면 한 번에 함께 올릴 수 있어요. 소희는 사장님이 직접 확인하고 승인한 글만 올립니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-1">
              <p className="text-sm font-bold text-foreground">지금 연결하면 바로 올릴 수 있어요</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                다음 화면에서 소희가 만든 첫 글을 먼저 확인하실 수 있어요. 연결은 나중에 설정 &gt; 연결에서도 언제든 하실 수 있습니다.
              </p>
              <p className="text-xs font-semibold text-primary">
                인스타그램·스레드 중 1곳 이상 연결하면 첫 포스팅을 무료로 제작해 드려요.
              </p>
            </div>
            <ChannelConnectNotice notice={channelNotice} />
            <ChannelRow name="인스타그램" description="사진과 함께 올리는 피드 게시물" connected={igConnected} href="/api/channels/instagram/connect?returnPath=/start?step=channels" />
            <ChannelRow name="스레드" description="짧은 글 중심의 소식 게시물" connected={thConnected} href="/api/channels/threads/connect?returnPath=/start?step=channels" />
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              연결 화면은 Meta(인스타그램) 공식 로그인 페이지로 이동해요. 소희는 비밀번호를 저장하지 않아요.
            </p>
            <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
              연결할 때 &quot;게시물 작성&quot; 권한까지 모두 허용해 주세요. 인스타그램은 비즈니스 또는 크리에이터 계정이어야 해요.
            </p>

            <BusinessVerifyCard
              verified={Boolean(state?.facts?.BUSINESS_VERIFIED)}
              onStart={() => setStep('business')}
            />

            <div className="flex flex-col gap-3 pt-2">
              <div className="flex gap-2">
                <Button variant="outline" className="h-11 min-h-[44px] min-w-[44px] px-4" onClick={() => setStep('tone')}>
                  <ChevronLeft aria-hidden /> 이전
                </Button>
                <Button
                  className="h-11 min-h-[44px] flex-1 font-bold"
                  disabled={!anyChannel}
                  onClick={() => router.push('/start/preview')}
                >
                  연결 완료 · 첫 글 만들기
                </Button>
              </div>
              <div className="flex flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-between sm:text-left">
                <p className="text-sm text-muted-foreground">
                  {anyChannel
                    ? '연결이 끝났어요. 첫 글을 확인하러 가볼까요?'
                    : '아직 연결하지 않아도 첫 글은 미리 볼 수 있어요'}
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs font-semibold text-primary underline-offset-4 hover:underline"
                  onClick={() => router.push('/start/preview')}
                >
                  나중에 연결할게요 · 첫 글 먼저 볼게요
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}

function ChannelRow(props: { name: string; description: string; connected: boolean; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
      <div>
        <div className="flex items-center gap-2 font-semibold">
          {props.name}
          {props.connected && <Badge variant="success">연결됨</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{props.description}</p>
      </div>
      {props.connected ? (
        <Check className="size-5 text-state-ok" aria-label="연결 완료" />
      ) : (
        <Button asChild variant="outline" className="min-h-[44px] min-w-[44px] px-4 inline-flex items-center justify-center">
          <a href={props.href}>연결하기</a>
        </Button>
      )}
    </div>
  )
}

/** 사업자 인증은 선택 사항이다. 흐름에서 사라지지 않도록 계정 연결 단계 안에 카드로 노출한다. */
function BusinessVerifyCard(props: { verified: boolean; onStart: () => void }) {
  if (props.verified) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-state-ok/30 bg-state-ok-soft p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" aria-hidden />
        <div className="space-y-0.5">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            사업자 인증 완료 <Badge variant="success">인증됨</Badge>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            인증된 사업자라서 발행 지원 혜택이 적용돼요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <p className="text-sm font-bold text-foreground">사업자 인증은 나중에 해도 괜찮아요</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          인증하면 발행 지원 혜택이 늘어나요. 첫 글을 먼저 확인하셔도 됩니다.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] shrink-0 px-4 text-sm font-semibold"
        onClick={props.onStart}
      >
        지금 인증하기
      </Button>
    </div>
  )
}
