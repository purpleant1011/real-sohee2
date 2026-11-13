'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ExternalLink, Loader2, PartyPopper, Sparkles } from 'lucide-react'
import { ChannelPreview } from '@/features/preview/channel-preview'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { QuickPostSummary } from '@/features/quick-start/quick-post-service'
import type { FirstValueView } from './first-value'
import { resolveFirstPostErrorGuidance } from './first-post-error-guidance'
import { FirstPostErrorCard } from './first-post-error-card'
import { InlineCopyEditor } from './inline-copy-editor'
import { ManualHandoffPanel } from './manual-handoff-panel'
import { BookingDestinationPanel } from './booking-destination-panel'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'

type StudioData = {
  item: QuickPostSummary & { workspaceId: string }
  view: FirstValueView
  imageNotice: string | null
}

type ErrorState = {
  message: string
  code?: string
  status?: number
}

function resolveStudioErrorGuidance(error: ErrorState): ReturnType<typeof resolveFirstPostErrorGuidance> {
  if (error.code === 'MEDIA_SELECTION_REQUIRED') {
    return {
      category: 'UNKNOWN',
      title: '사용할 사진을 다시 골라 주세요',
      description: '여러 사진 중 이번 글에 쓸 사진을 직접 선택해 주세요. 선택 전에는 생성을 다시 요청하지 않아요.',
      primaryAction: { label: '사진 다시 고르기', href: '/start', actionType: 'navigate', variant: 'default' },
    }
  }
  if (error.code === 'WRITE_BLOCKED') {
    // 오프라인·중복 클릭으로 요청을 내보내지 않은 경우. 가드가 준 이유를 그대로 보여 주고
    // 일반 오류 문구로 덮지 않는다(사장님이 다시 누르면 되는 상황인지 알 수 있어야 한다).
    return {
      category: 'UNKNOWN',
      title: '아직 발행하지 않았어요',
      description: error.message,
      primaryAction: { label: '다시 시도', actionType: 'retry', variant: 'default' },
    }
  }
  if (error.code === 'FACT_REVIEW_REQUIRED' || error.code === 'FACT_SNAPSHOT_STALE') {
    return {
      category: 'UNKNOWN',
      title: '가게 정보를 다시 확인해야 해요',
      description: '가게 정보가 변경되었거나 최신 정보 확인이 필요해요. 원고를 다시 검토해 주세요.',
      primaryAction: {
        label: '원고 다시 검토하기',
        href: '/app/content',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }
  return resolveFirstPostErrorGuidance(error)
}

type PublishStep = 'IDLE' | 'UPLOADING' | 'VERIFYING' | 'DONE'

type ChannelOutcome = {
  channel: 'instagram' | 'threads'
  verified: boolean
  permalink: string | null
  errorCode: string | null
  status: 'VERIFIED' | 'FAILED' | 'RESULT_UNKNOWN'
}

type PublishResultData = {
  permalink: string | null
  channel: string | null
  overallStatus: 'ALL_VERIFIED' | 'PARTIAL_SUCCESS' | 'FAILED' | 'RESULT_UNKNOWN'
  results: ChannelOutcome[]
}

export type StudioPhase =
  | 'loading'
  | 'preview'
  | 'updating'
  | 'confirming'
  | 'publishing'
  | 'published'
  | 'saving'
  | 'saved'
  | 'error'

/**
 * ANI-1599: 채널이 없어 초안 생성이 막힌 사장님께 "다음에 무엇을 할 수 있는지"를 보여준다.
 * 초안이 아직 없으므로 여기서 보관·복사를 대신 실행하지 않는다. 대신 준비가 끝나면
 * 채널 연결 없이도 보관·복사로 이어갈 수 있다는 사실과, 복사는 게시가 아니라는 점을 알린다.
 */
function ChannellessAlternatives({
  guidance,
  code,
}: {
  guidance: ReturnType<typeof resolveStudioErrorGuidance>
  code?: string | null
}) {
  if (guidance.category !== 'CHANNELS_DISCONNECTED') return null
  const preparationBlocked = code === 'PREPARATION_INCOMPLETE'
  return (
    <section
      role="region"
      aria-label="채널 연결 전에 할 수 있는 일"
      className="mx-auto mt-4 w-full max-w-md space-y-2 rounded-xl border bg-card p-4 text-sm"
    >
      <h2 className="font-semibold text-foreground">채널 연결 전에 할 수 있는 일</h2>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {preparationBlocked ? (
          <li>가게 정보·말투·사진 기준을 확인하면 첫 초안을 만들 수 있어요.</li>
        ) : null}
        <li>초안이 준비되면 채널을 연결하지 않아도 보관함에 담아 둘 수 있어요.</li>
        <li>글을 복사해 사장님이 직접 올릴 수도 있어요.</li>
        <li>복사만으로 게시되지는 않아요. 실제 게시 여부는 소희가 확인하지 않아요.</li>
      </ul>
    </section>
  )
}

export function FirstValueStudio({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const router = useRouter()
  const [phase, setPhase] = useState<StudioPhase>('loading')
  const [data, setData] = useState<StudioData | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)
  const [isTakingLong, setIsTakingLong] = useState(false)
  const [previewTab, setPreviewTab] = useState<'threads' | 'instagram'>('threads')
  const [editing, setEditing] = useState(false)
  const [showBookingDestination, setShowBookingDestination] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  // 발행 세부 상태
  const [publishStep, setPublishStep] = useState<PublishStep>('IDLE')
  const [publishResult, setPublishResult] = useState<PublishResultData | null>(null)

  // 카운트다운 & 화면 전환 상태
  const [countdown, setCountdown] = useState<number | null>(null)
  const [isNavigatingToApp, setIsNavigatingToApp] = useState(false)
  const [transitionProgress, setTransitionProgress] = useState(30)
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const runExternalWrite = useExternalWriteGuard()

  const key = useRef<string | null>(null)
  const viewed = useRef<string | null>(null)
  const activeRef = useRef(true)
  const lastActionRef = useRef<'load' | 'save' | 'publish'>('load')
  const savedBeforeRef = useRef(false)
  // 발행 확인 패널에서 취소할 때마다 올린다 — 연결 확인이 끝나도 진행 중이던 발행을 무효화한다.
  const cancelSeqRef = useRef(0)
  const savedCardTitleRef = useRef<HTMLHeadingElement | null>(null)
  const publishedCardTitleRef = useRef<HTMLHeadingElement | null>(null)

  const LOADING_MESSAGES = [
    { title: '가게 정보와 목표를 확인하는 중', desc: '사장님이 알려주신 가게 특징을 바탕으로 초안을 준비하고 있어요.' },
    { title: '채널에 알맞은 글을 작성하는 중', desc: '선택하신 주제와 가게 분위기에 맞추어 문장과 해시태그를 정리하고 있어요.' },
    { title: '초안과 미리보기를 정리하는 중', desc: '준비된 내용을 꼼꼼하게 확인하고 다듬어 완성하고 있어요.' },
    { title: '첫 마케팅 초안을 준비하는 중', desc: '잠시 후 소희가 준비한 첫 초안을 직접 확인해 보세요.' },
  ]

  // 로딩 단계 인터랙션 애니메이션 (4초마다 자연스럽게 다음 단계로 전환)
  useEffect(() => {
    if (phase !== 'loading' || data) return
    const interval = setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % LOADING_MESSAGES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [phase, data, LOADING_MESSAGES.length])

  const fetchFirstValue = useCallback(() => {
    setPhase('loading')
    setError(null)
    setIsTakingLong(false)
    setLoadingStepIndex(0)
    lastActionRef.current = 'load'

    const timer = setTimeout(() => {
      if (activeRef.current) {
        setIsTakingLong(true)
      }
    }, 60_000)

    const search = typeof window !== 'undefined' ? window.location.search : ''
    const endpoint = search ? `/api/first-value${search}` : '/api/first-value'

    fetcher(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        clearTimeout(timer)
        const result = await response.json()
        if (!response.ok) {
          const err: ErrorState = {
            message: result.error ?? '미리보기를 준비하지 못했어요.',
            code: result.code,
            status: response.status,
          }
          throw err
        }
        if (activeRef.current) {
          setData(result)
          setPhase('preview')
          // Preserve missionId in browser history for device/tab/OAuth resume
          if (typeof window !== 'undefined' && result.item?.missionId) {
            const currentUrl = new URL(window.location.href)
            if (currentUrl.searchParams.get('missionId') !== result.item.missionId) {
              currentUrl.searchParams.set('missionId', result.item.missionId)
              window.history.replaceState(null, '', currentUrl.toString())
            }
          }
        }
      })
      .catch((cause) => {
        clearTimeout(timer)
        if (activeRef.current) {
          if (cause && typeof cause === 'object' && 'message' in cause) {
            setError(cause as ErrorState)
          } else {
            setError({ message: '미리보기를 준비하지 못했어요.' })
          }
          setPhase('error')
        }
      })

    return () => {
      clearTimeout(timer)
    }
  }, [fetcher])

  useEffect(() => {
    activeRef.current = true
    const cleanup = fetchFirstValue()
    return () => {
      activeRef.current = false
      if (cleanup) cleanup()
    }
  }, [fetchFirstValue])

  useEffect(() => {
    if (!data || viewed.current === data.item.missionId) return
    viewed.current = data.item.missionId
    void fetcher('/api/onboarding/funnel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: data.item.workspaceId,
        event: 'preview_viewed',
        missionId: data.item.missionId,
        revision: data.item.revision,
      }),
    }).catch(() => undefined)
  }, [data, fetcher])

  // 보관 성공 시 포커스 이동 및 스크롤
  useEffect(() => {
    if (phase === 'saved' && savedCardTitleRef.current) {
      savedCardTitleRef.current.focus?.()
      if (typeof savedCardTitleRef.current.scrollIntoView === 'function') {
        savedCardTitleRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [phase])

  // 발행 성공 시 포커스 이동 및 5초 카운트다운 (prefers-reduced-motion 확인)
  useEffect(() => {
    if (phase !== 'published') return

    if (publishedCardTitleRef.current) {
      publishedCardTitleRef.current.focus?.()
      if (typeof publishedCardTitleRef.current.scrollIntoView === 'function') {
        publishedCardTitleRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion || (publishResult?.overallStatus && publishResult.overallStatus !== 'ALL_VERIFIED')) {
      return
    }

    setCountdown(5)
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null
        if (prev <= 1) {
          clearInterval(interval)
          void navigateToApp()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // 소희 작업실 전환 화면 진행
  async function navigateToApp() {
    setCountdown(null)
    setIsNavigatingToApp(true)
    setTransitionProgress(45)

    try {
      router.prefetch('/app')
    } catch {
      // router prefetch fallback
    }

    if (data?.item.workspaceId) {
      void fetcher('/api/onboarding/funnel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: data.item.workspaceId,
          event: 'onboarding_completed',
          missionId: data.item.missionId,
        }),
      }).catch(() => undefined)
    }

    setTimeout(() => {
      setTransitionProgress(90)
    }, 400)

    setTimeout(() => {
      try {
        router.push('/app?welcome=first-post')
      } catch {
        window.location.href = '/app?welcome=first-post'
      }
    }, 900)
  }

  async function saveCopies(copies: QuickPostSummary['copies']) {
    if (!data) return
    const response = await fetcher(`/api/workspaces/${encodeURIComponent(data.item.workspaceId)}/quick-post`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missionId: data.item.missionId, scope: 'text', copies }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '수정 내용을 저장하지 못했어요.')
    key.current = null
    savedBeforeRef.current = false
    setEditing(false)
    setCopyNotice(null)
    fetchFirstValue()
  }

  async function applyBookingDestination(url: string) {
    if (!data || phase !== 'preview') return
    setPhase('updating')
    setError(null)
    lastActionRef.current = 'load'
    const append = (text: string) => text.includes(url) ? text : `${text}\n\n${url}`
    try {
      await saveCopies({
        instagram: { ...data.item.copies.instagram, caption: append(data.item.copies.instagram.caption) },
        threads: { content: append(data.item.copies.threads.content) },
      })
      setShowBookingDestination(false)
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : '예약 주소를 원고에 넣지 못했어요.', code: 'COPY_SAVE_FAILED', status: 503 })
      setPhase('error')
      throw cause
    }
  }

  async function copyText(channel: 'instagram' | 'threads') {
    if (!data) return
    setCopyNotice(null)
    const text = channel === 'instagram'
      ? [data.item.copies.instagram.caption, ...(data.item.copies.instagram.hashtags ?? [])].join('\n')
      : data.item.copies.threads.content
    try {
      await navigator.clipboard.writeText(text)
      setCopyNotice('글을 복사했어요. 직접 올리기 전이며 게시 여부는 확인되지 않았어요.')
    } catch {
      setCopyNotice('복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요.')
    }
  }

  async function save() {
    if (!data?.view.contentId || !data.view.versionId || phase === 'saving' || phase === 'saved') return
    lastActionRef.current = 'save'
    setPhase('saving')
    setError(null)
    try {
      key.current ??= crypto.randomUUID()
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(data.item.workspaceId)}/vault`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentId: data.view.contentId,
          versionId: data.view.versionId,
          channels: ['threads'],
          targetDate: null,
          idempotencyKey: key.current,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.saved?.length || result.external_posts !== 0) {
        throw {
          message: result.error ?? result.rejected?.[0]?.reason_label ?? '보관하지 못했어요. 다시 시도해 주세요.',
          code: result.code ?? 'VAULT_SAVE_FAILED',
          status: response.status,
        }
      }
      savedBeforeRef.current = true
      setPhase('saved')
    } catch (cause: any) {
      setError({
        message: cause?.message ?? '보관하지 못했어요. 다시 시도해 주세요.',
        code: cause?.code ?? 'VAULT_SAVE_FAILED',
        status: cause?.status ?? 500,
      })
      setPhase('error')
    }
  }

  async function publish(retryChannel?: 'instagram' | 'threads') {
    if (!data || phase === 'publishing') return
    const target = data
    lastActionRef.current = 'publish'
    setError(null)

    // 게시·재게시는 실제 외부 쓰기다. 오프라인이거나 같은 건이 이미 진행 중이면 요청을 내보내지 않는다(ANI-1778).
    // 연결 확인(probe)을 기다리는 동안 화면은 아직 'confirming' 이고 취소 버튼도 살아 있다.
    // 그 사이 '나중에 할게요'로 취소하면, 확인이 끝난 뒤에도 게시 요청이 나가면 안 된다.
    const cancelSeq = cancelSeqRef.current
    const outcome = await runExternalWrite('publish', `first-post:${target.item.missionId}`, async () => {
      if (cancelSeq !== cancelSeqRef.current) return
      setPhase('publishing')
      setPublishStep('UPLOADING')

      try {
        setTimeout(() => {
          if (activeRef.current) setPublishStep('VERIFYING')
        }, 700)

        const bodyPayload = {
          missionId: target.item.missionId,
          revision: target.item.revision,
          fingerprint: target.item.approvalFingerprint,
          reviewedImageIds: target.item.imageIds,
          ...(retryChannel ? { retryChannel } : {}),
        }

        const response = await fetcher('/api/first-value/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        })
        const result = await response.json()
        if (!response.ok) {
          throw {
            message: result.error ?? '발행 준비를 다시 확인해 주세요.',
            code: result.code ?? 'PUBLISH_FAILED',
            status: response.status,
          }
        }

        setPublishStep('DONE')

        const channelResults: ChannelOutcome[] = Array.isArray(result.results)
          ? result.results
          : [
              {
                channel: (result.channel || 'threads') as 'instagram' | 'threads',
                verified: Boolean(result.verified),
                permalink: result.permalink || null,
                errorCode: null,
                status: result.verified ? ('VERIFIED' as const) : ('FAILED' as const),
              },
            ]

        setPublishResult({
          permalink: result.permalink || null,
          channel: result.channel || 'threads',
          overallStatus: result.overallStatus || (result.verified ? 'ALL_VERIFIED' : 'FAILED'),
          results: channelResults,
        })
        setPhase('published')
      } catch (cause: any) {
        setPublishStep('IDLE')
        setError({
          message: cause?.message ?? '발행하지 못했어요. 다시 확인해 주세요.',
          code: cause?.code ?? 'PUBLISH_FAILED',
          status: cause?.status ?? 500,
        })
        setPhase('error')
      }
    })

    if (!outcome.ran) {
      setPublishStep('IDLE')
      setError({
        message: outcome.decision.message,
        code: 'WRITE_BLOCKED',
        status: 0,
      })
      setPhase('error')
    }
  }

  function handleRetry() {
    if (error?.code === 'STALE_DRAFT' || error?.status === 409) {
      fetchFirstValue()
    } else if (lastActionRef.current === 'publish') {
      void publish()
    } else if (lastActionRef.current === 'save') {
      void save()
    } else {
      fetchFirstValue()
    }
  }

  // 전환 화면 (최대 1.5초)
  if (isNavigatingToApp) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-24 sm:py-32 text-center space-y-6">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="rounded-full bg-primary/10 p-4 text-primary">
            <Sparkles className="h-8 w-8 animate-pulse" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-foreground">소희 작업실을 준비하고 있어요…</h1>
          <p className="text-sm text-muted-foreground">잠시 후 메인 화면으로 이동합니다.</p>
        </div>
        <Progress value={transitionProgress} aria-label="작업실 이동 진행률" className="h-2" />
      </main>
    )
  }

  // 데이터 로드 전 상태 (에러, 타임아웃, 일반 로딩)
  if (!data) {
    if (phase === 'error' && error) {
      const guidance = resolveStudioErrorGuidance(error)
      return (
        <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
          <FirstPostErrorCard guidance={guidance} onRetry={fetchFirstValue} isLoading={false} />
          <ChannellessAlternatives guidance={guidance} code={error.code} />
        </main>
      )
    }

    if (isTakingLong) {
      return (
        <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
          <div role="status" className="space-y-4 rounded-xl border bg-card p-6 text-center">
            <p className="text-sm font-medium text-foreground">조금 오래 걸리고 있어요. 다시 시도해 보실 수 있어요.</p>
            <Button variant="outline" className="min-h-11 font-medium" onClick={fetchFirstValue} disabled={phase === 'loading'}>
              다시 시도
            </Button>
          </div>
        </main>
      )
    }

    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-20">
        <div role="status" aria-live="polite" className="rounded-2xl border border-primary/20 bg-card/60 p-8 text-center shadow-lg space-y-6">
          <div className="relative mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-8 animate-pulse text-primary" aria-hidden="true" />
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-lg font-bold text-foreground transition-all duration-300">
              {LOADING_MESSAGES[loadingStepIndex].title}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed transition-all duration-300">
              {LOADING_MESSAGES[loadingStepIndex].desc}
            </p>
          </div>

          {/* 4단계 스텝 인디케이터 바 */}
          <div className="flex justify-center items-center gap-1.5 pt-2">
            {LOADING_MESSAGES.map((msg, idx) => (
              <div
                key={msg.title}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-500',
                  idx === loadingStepIndex
                    ? 'w-8 bg-primary'
                    : idx < loadingStepIndex
                    ? 'w-2 bg-primary/50'
                    : 'w-2 bg-muted'
                )}
                aria-hidden="true"
              />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground/70 font-mono">
            사장님 가게에 어울리는 첫 글을 준비하고 있어요…
          </p>
        </div>
      </main>
    )
  }

  const { item, view } = data
  const hasConnectedSns = item.channels && item.channels.length > 0
  const effectiveProgress = phase === 'saved' || phase === 'published' ? 100 : view.progressPercent

  const hasInstagram =
    Boolean(item.channels?.some((c) => c.provider === 'instagram')) ||
    Boolean(view.channelViews?.some((c) => c.channel === 'instagram'))
  const hasThreads =
    Boolean(item.channels?.some((c) => c.provider === 'threads')) ||
    Boolean(view.channelViews?.some((c) => c.channel === 'threads'))
  const hasBothChannels = hasInstagram && hasThreads
  const hasInstagramOnly = hasInstagram && !hasThreads
  const activePreviewChannel = hasBothChannels
    ? previewTab
    : hasInstagramOnly
    ? 'instagram'
    : 'threads'

  const activeChannelView = view.channelViews?.find((cv) => cv.channel === activePreviewChannel)
  const activeExcluded = view.excludedChannels?.find((ex) => ex.channel === activePreviewChannel)
  const isCurrentChannelReconnectRequired = Boolean(
    activeChannelView?.reconnectRequired || activeExcluded?.reconnectRequired
  )
  const currentReconnectUrl =
    activeChannelView?.reconnectUrl ||
    activeExcluded?.reconnectUrl ||
    `/api/channels/${activePreviewChannel}/connect?returnPath=/start/preview`

  const isInstagramReconnectRequired = Boolean(
    view.channelViews?.find((cv) => cv.channel === 'instagram')?.reconnectRequired ||
    view.excludedChannels?.find((ex) => ex.channel === 'instagram')?.reconnectRequired
  )
  const isThreadsReconnectRequired = Boolean(
    view.channelViews?.find((cv) => cv.channel === 'threads')?.reconnectRequired ||
    view.excludedChannels?.find((ex) => ex.channel === 'threads')?.reconnectRequired
  )

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8 sm:py-12">
      <header className="space-y-3">
        <p className="text-sm font-medium text-primary">우리 가게 첫 글</p>
        <h1 className="text-2xl font-bold">사장님 말투로 쓴 첫 초안이에요</h1>
        <Progress value={effectiveProgress} aria-label="첫 글 준비 진행률" />
        <p className="text-sm text-foreground">
          {phase === 'saved' || phase === 'published'
            ? '첫 글 준비가 끝났어요. 소희와 함께 마케팅을 이어가 보세요.'
            : view.liveRolloutBlocked
              ? '실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 담아 둘 수 있어요.'
              : view.action === 'PUBLISH'
                ? '채널 연결이 확인됐어요. 글을 확인하고 승인하면 바로 올라가요.'
                : '첫 글을 확인하는 중이에요. 채널 연결은 나중에 해도 돼요.'}
        </p>
      </header>

      <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="가게 요약">
        <h2 className="font-semibold">사장님 가게를 이렇게 이해했어요</h2>
        <p className="break-words text-sm">{view.summary}</p>
      </section>

      {data.imageNotice && (
        <p role="alert" className="rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-950">
          {data.imageNotice}
        </p>
      )}

      <section className="space-y-3" aria-label="첫 초안 미리보기">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">첫 초안 미리보기</h2>
          {hasBothChannels && (
            <div role="tablist" aria-label="채널 선택" className="flex rounded-lg border bg-muted p-0.5">
              <button
                role="tab"
                aria-selected={previewTab === 'instagram'}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  previewTab === 'instagram'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setPreviewTab('instagram')}
              >
                인스타그램
                {isInstagramReconnectRequired && (
                  <span className="ml-1 text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">(연결 확인)</span>
                )}
              </button>
              <button
                role="tab"
                aria-selected={previewTab === 'threads'}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  previewTab === 'threads'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setPreviewTab('threads')}
              >
                스레드
                {isThreadsReconnectRequired && (
                  <span className="ml-1 text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">(연결 확인)</span>
                )}
              </button>
            </div>
          )}
        </div>

        {isCurrentChannelReconnectRequired && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground"
          >
            <span>💡 안전한 첫 발행을 위해 계정 연결 확인이 필요해요. 확인 후 바로 올릴 수 있어요.</span>
            <Button asChild size="sm" variant="default" className="h-7 px-2.5 text-xs shrink-0 self-start sm:self-auto font-medium">
              <Link href={currentReconnectUrl}>
                계정 확인하고 올리기
              </Link>
            </Button>
          </div>
        )}

        {activePreviewChannel === 'instagram' ? (
          <ChannelPreview
            channel="instagram"
            variant={{
              handle: item.channels.find((c) => c.provider === 'instagram')?.handle || item.businessName,
              caption: item.copies.instagram?.caption || '',
              hashtags: item.copies.instagram?.hashtags || [],
              imageUrl: item.imageUrl,
            }}
          />
        ) : (
          <ChannelPreview
            channel="threads"
            variant={{
              handle: item.channels.find((c) => c.provider === 'threads')?.handle || item.businessName,
              caption: item.copies.threads.content,
              imageUrl: item.imageUrl,
            }}
          />
        )}
      </section>

      {/* 3대 핵심 기둥 3번째: 소희에게 맡길 작업 범위 (Delegation Scope) */}
      <section className="space-y-3 rounded-xl border border-purple-500/20 bg-purple-50/40 p-4" aria-label="위임 범위">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground flex items-center gap-1.5 text-sm sm:text-base">
            <Sparkles className="size-4 text-purple-600" aria-hidden="true" />
            소희에게 맡길 작업 범위
          </h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-900">
            {typeof view.delegationScope?.costCredits === 'number'
              ? `${view.delegationScope.costCredits} 크레딧`
              : '비용 확인 중'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="space-y-1 rounded-lg border bg-background/90 p-2.5">
            <span className="font-semibold text-muted-foreground">목표 및 범위</span>
            <p className="text-foreground">{view.delegationScope?.goal || '우리 가게 첫 인사 및 소개글 작성'}</p>
          </div>
          <div className="space-y-1 rounded-lg border bg-background/90 p-2.5">
            <span className="font-semibold text-muted-foreground">발행 대상 채널</span>
            <p className="text-foreground">
              {item.channels?.length
                ? item.channels.map((c) => (c.provider === 'instagram' ? '인스타그램' : '스레드')).join(', ')
                : '채널 연결 후 지정'}
            </p>
          </div>
          <div className="space-y-1 rounded-lg border bg-background/90 p-2.5">
            <span className="font-semibold text-muted-foreground">안전 원칙</span>
            <p className="text-foreground">사장님 직접 승인 전에는 외부 게시 0건</p>
          </div>
          <div className="space-y-1 rounded-lg border bg-background/90 p-2.5">
            <span className="font-semibold text-muted-foreground">계약상 관찰 기간</span>
            <p className="text-foreground">
              {view.delegationScope?.observationWindowDays
                ? `${view.delegationScope.observationWindowDays}일간 상태 관찰`
                : '관찰 기간 확인 중'}
            </p>
          </div>
        </div>
      </section>

      {/* 액션 및 상태 영역: 단일 phase 상태기계로 한 번에 하나의 패널만 렌더링 */}

      {/* 1. 오류 카드 (다른 패널 숨김) */}
      {phase === 'error' && error?.code === 'STALE_DRAFT' && (
        <section role="alert" className="space-y-3 rounded-xl border bg-card p-4">
          <p>글이 변경되었어요. 최신 내용을 확인한 뒤 다시 승인해 주세요.</p>
          <Button className="min-h-11" onClick={fetchFirstValue}>최신 내용 다시 확인</Button>
        </section>
      )}
      {phase === 'error' && error && error.code !== 'STALE_DRAFT' && (
        <FirstPostErrorCard
          guidance={resolveStudioErrorGuidance(error)}
          onRetry={handleRetry}
          onVault={() => void save()}
          isLoading={false}
        />
      )}

      {phase === 'preview' && editing && (
        <InlineCopyEditor copies={item.copies} onSave={saveCopies} onCancel={() => setEditing(false)} />
      )}
      {phase === 'preview' && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" onClick={() => setEditing(true)}>글 직접 수정</Button>
          <Button className="min-h-11" variant="outline" onClick={() => void copyText(activePreviewChannel)}>글 복사</Button>
          <Button className="min-h-11" variant="outline" aria-expanded={showBookingDestination} aria-controls={showBookingDestination ? 'booking-destination-settings' : undefined} onClick={() => setShowBookingDestination(value => !value)}>예약 링크 설정</Button>
        </div>
      )}
      {phase === 'preview' && !editing && showBookingDestination && (
        <div id="booking-destination-settings">
          <BookingDestinationPanel key={item.workspaceId} workspaceId={item.workspaceId} onApply={applyBookingDestination} fetcher={fetcher} />
        </div>
      )}
      {phase === 'updating' && <p role="status" aria-live="polite" className="rounded-xl border bg-card p-4 text-sm">예약 주소를 원고에 저장하고 있어요.</p>}
      {phase === 'loading' && <p role="status" className="text-sm text-muted-foreground">최신 원고를 다시 확인하고 있어요.</p>}
      {copyNotice && <p role="status" aria-label="수동 게시 준비 상태" className="text-sm text-muted-foreground">{copyNotice}</p>}

      {/* 2. 초안 미리보기 액션 (preview) */}
      {phase === 'preview' && !editing && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">{view.message}</p>
          {view.excludedChannels && view.excludedChannels.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-50/50 p-3 text-xs text-amber-950 space-y-2">
              {view.excludedChannels.map((ex) => (
                <div key={ex.channel} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                  <p>
                    <span className="font-semibold">{ex.name}:</span> {ex.reason}
                  </p>
                  {ex.reconnectRequired && (
                    <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0 self-start sm:self-auto font-medium">
                      <Link href={ex.reconnectUrl || `/api/channels/${ex.channel}/connect?returnPath=/start/preview`}>
                        계정 확인하고 올리기
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {view.action === 'VAULT' ? (
            <div className="space-y-3">
              {!hasConnectedSns && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                      <Sparkles className="size-4 text-primary" aria-hidden="true" />
                      연결 전에도 글을 보관하거나 복사할 수 있어요
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      채널 연결 후 게시 가능 여부를 다시 확인해요. 글을 복사해 직접 올릴 수도 있으며, 복사만으로 게시되지는 않아요.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button asChild className="h-11 min-h-[44px] font-bold">
                      <a href="/api/channels/instagram/connect?returnPath=/start/preview">
                        인스타그램 연결하고 발행
                      </a>
                    </Button>
                    <Button asChild variant="outline" className="h-11 min-h-[44px] font-semibold">
                      <a href="/api/channels/threads/connect?returnPath=/start/preview">
                        스레드 연결하고 발행
                      </a>
                    </Button>
                  </div>
                </div>
              )}
              <Button
                className="min-h-11 w-full font-medium"
                variant={!hasConnectedSns ? 'outline' : 'default'}
                disabled={!view.contentId || !view.versionId}
                onClick={() => void save()}
              >
                {view.actionLabel}
              </Button>
            </div>
          ) : (
            <Button
              className="min-h-11 w-full font-medium"
              onClick={() => setPhase('confirming')}
            >
              {view.targetChannelsText
                ? `${view.actionLabel} · ${view.targetChannelsText}`
                : view.actionLabel}
            </Button>
          )}
        </div>
      )}

      {/* 3. 보관 진행 중 (saving) */}
      {phase === 'saving' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">{view.message}</p>
          <Button
            className="min-h-11 w-full font-medium"
            disabled
            aria-busy="true"
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            보관하는 중…
          </Button>
        </div>
      )}

      {/* 4. 발행 확인 다이얼로그 (confirming) */}
      {phase === 'confirming' && (
        <div role="alertdialog" aria-label="발행 확인" className="space-y-3 rounded-xl border bg-card p-4">
          <p className="font-semibold text-foreground">
            {view.targetChannelsText
              ? `${view.targetChannelsText.replace(/에 올려요$/, '에')} 실제로 올라가요. 계속할까요?`
              : '발행은 연결된 채널에 실제로 올라가요. 계속할까요?'}
          </p>
          <p className="text-sm text-muted-foreground">발행 전 채널과 원고를 다시 확인해 주세요.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              className="min-h-11 font-medium"
              onClick={() => void publish()}
            >
              네, 발행할게요
            </Button>
            <Button
              variant="outline"
              className="min-h-11 font-medium"
              onClick={() => {
                // 확인 대기 중 취소 — 연결 확인이 끝나도 게시 요청이 나가지 않도록 진행 중이던 발행을 무효화한다.
                cancelSeqRef.current += 1
                setPhase(savedBeforeRef.current ? 'saved' : 'preview')
              }}
            >
              나중에 할게요
            </Button>
          </div>
        </div>
      )}

      {/* 5. 발행 진행 스텝퍼 (publishing) */}
      {phase === 'publishing' && (
        <div
          role="status"
          aria-busy="true"
          className="space-y-3 rounded-xl border bg-muted/40 p-4 text-center sm:text-left"
        >
          <div className="flex items-center gap-2 justify-center sm:justify-start">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">
              {publishStep === 'UPLOADING' && '1단계: 채널에 글을 올리는 중…'}
              {publishStep === 'VERIFYING' && '2단계: 실제로 올라간 것을 확인하는 중…'}
              {publishStep === 'DONE' && '3단계: 완료!'}
            </span>
          </div>
          {view.targetChannels && view.targetChannels.length > 1 ? (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground pl-6">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">인스타그램:</span>
                <span>{publishStep === 'UPLOADING' ? '올리는 중…' : publishStep === 'VERIFYING' ? '확인하는 중…' : '완료'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">스레드:</span>
                <span>{publishStep === 'UPLOADING' ? '올리는 중…' : publishStep === 'VERIFYING' ? '확인하는 중…' : '완료'}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">잠시만 기다려 주세요. 실제 발행 결과를 확인하고 있어요.</p>
          )}
        </div>
      )}

      {/* 6. 보관 완료 카드 (saved) */}
      {phase === 'saved' && (
        <Card
          role="status"
          aria-live="polite"
          className="border-indigo-500/20 bg-gradient-to-b from-indigo-50/50 to-background shadow-sm"
        >
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-indigo-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <Badge variant="outline" className="border-indigo-500/30 text-indigo-700 bg-indigo-50">
                보관 완료
              </Badge>
            </div>
            <CardTitle
              ref={savedCardTitleRef}
              tabIndex={-1}
              className="text-xl font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              첫 글을 보관함에 담았어요
            </CardTitle>
            <CardDescription className="text-sm text-foreground/80 leading-relaxed">
              아직 아무것도 게시되지 않았어요. 인스타그램이나 스레드를 연결하면 사장님이 직접 확인하고 올릴 수 있어요.
            </CardDescription>
          </CardHeader>

          <CardFooter className="flex flex-col gap-2.5 pt-2">
            {!hasConnectedSns ? (
              <Button size="lg" className="w-full min-h-11 font-medium" asChild>
                <Link href="/start?step=channels">채널 연결하고 올리기</Link>
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full min-h-11 font-medium"
                onClick={() => setPhase('confirming')}
              >
                바로 올려보기
              </Button>
            )}

            <Button
              variant="outline"
              size="lg"
              className="w-full min-h-11 font-medium"
              asChild
            >
              <Link href="/app/vault">보관함에서 보기</Link>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="w-full min-h-11 text-muted-foreground hover:text-foreground"
              onClick={() => void navigateToApp()}
            >
              소희 작업실로 이동
            </Button>
          </CardFooter>
        </Card>
      )}

      {phase === 'saved' && view.contentId && view.versionId && (
        <ManualHandoffPanel workspaceId={item.workspaceId} contentId={view.contentId} versionId={view.versionId} channel="threads" fetcher={fetcher} />
      )}

      {/* 7. 발행 완료(축하) 카드 (published) */}
      {phase === 'published' && (
        <Card
          role="status"
          aria-live="polite"
          className="border-emerald-500/20 bg-gradient-to-b from-emerald-50/60 to-background shadow-sm"
        >
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-600">
              <PartyPopper className="h-6 w-6" aria-hidden="true" />
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 bg-emerald-50">
                {publishResult?.overallStatus === 'ALL_VERIFIED'
                  ? '발행 완료'
                  : publishResult?.overallStatus === 'PARTIAL_SUCCESS'
                  ? '일부 완료'
                  : '확인 중'}
              </Badge>
            </div>
            <CardTitle
              ref={publishedCardTitleRef}
              tabIndex={-1}
              className="text-xl font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
            >
              {publishResult?.overallStatus === 'ALL_VERIFIED'
                ? '첫 게시물이 올라갔어요'
                : publishResult?.overallStatus === 'PARTIAL_SUCCESS'
                ? '일부 채널에 첫 소식이 올라갔어요'
                : '게시 결과를 확인하고 있어요'}
            </CardTitle>
            <CardDescription className="text-sm text-foreground/80 leading-relaxed">
              {publishResult?.overallStatus === 'ALL_VERIFIED'
                ? '사장님의 첫 소식이 성공적으로 발행되었습니다.'
                : publishResult?.overallStatus === 'PARTIAL_SUCCESS'
                ? '성공한 채널에 소식이 발행되었어요. 실패한 채널만 다시 시도할 수 있어요.'
                : '채널 연결 상태를 확인하고 있어요.'}
            </CardDescription>

            <div className="space-y-2 pt-1">
              {(publishResult?.results ?? [
                {
                  channel: (publishResult?.channel || 'threads') as 'instagram' | 'threads',
                  verified: true,
                  permalink: publishResult?.permalink || null,
                  errorCode: null,
                  status: 'VERIFIED' as const,
                },
              ]).map((res) => {
                const channelName = res.channel === 'instagram' ? '인스타그램' : '스레드'
                return (
                  <div
                    key={res.channel}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/80 p-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{channelName}</span>
                      {res.status === 'VERIFIED' && (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 text-xs">
                          발행 완료
                        </Badge>
                      )}
                      {res.status === 'RESULT_UNKNOWN' && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                          확인 중
                        </Badge>
                      )}
                      {res.status === 'FAILED' && (
                        <Badge variant="destructive" className="text-xs">
                          발행 실패
                        </Badge>
                      )}
                      {res.permalink && (
                        <a
                          href={res.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline ml-1"
                        >
                          게시물 보기
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>

                    {res.status === 'FAILED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium"
                        onClick={() => void publish(res.channel)}
                      >
                        실패한 채널만 다시 시도
                      </Button>
                    )}

                    {res.status === 'RESULT_UNKNOWN' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium"
                        onClick={() => void publish(res.channel)}
                      >
                        확인 중 · 다시 확인하기
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>

            {countdown !== null && countdown > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {countdown}초 후 소희 작업실로 이동해요.
              </p>
            )}
          </CardHeader>

          <CardFooter className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <Button
              size="lg"
              className="w-full sm:flex-1 min-h-11 font-medium"
              onClick={() => void navigateToApp()}
            >
              소희 작업실로 이동
            </Button>
            {countdown !== null && (
              <Button
                variant="ghost"
                size="lg"
                className="w-full sm:w-auto min-h-11 text-muted-foreground hover:text-foreground"
                onClick={() => setCountdown(null)}
              >
                이동하지 않기
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </main>
  )
}
