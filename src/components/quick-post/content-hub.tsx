'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ChevronLeft, ChevronRight, ImageIcon, Loader2, RefreshCw, Rocket, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/modal'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/features/empty-states/empty-state'
import { FourChannelStudio } from '@/features/channel-studio/ui/four-channel-studio'
import { NaverPostPanel } from '@/features/channel-studio/naver/ui/naver-post-panel'
import { NaverPlaceConnectCard } from '@/features/knowledge/naver-place/naver-place-connect-card'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { ComposerCard } from './composer-card'
import { PostDetail } from './post-detail'
import type { QuickPostApprovalOptions } from '@/features/quick-start/quick-post-vault-contract'
import { STAGE_LABEL, stageOf, type QuickPostItem } from './types'
import { contentHubQueryParsers } from './content-hub-query-state'

type Filter = 'waiting' | 'published' | 'all'
type ChannelFilter = 'all' | 'instagram' | 'threads'
type ReviseScope = 'text' | 'image' | 'both'

const APPROVAL_PHRASE = '이 버전 승인하고 발행'

function createApi(request: typeof fetch) {
  return async function api<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await request(input, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data?.error?.message ?? data?.error ?? '요청을 처리하지 못했어요.') as Error & { code?: string; blockers?: { href: string }[]; status?: number }
      err.status = res.status
      err.code = data?.code
      err.blockers = data?.blockers
      throw err
    }
    return data as T
  }
}

export function ContentHubWorkspace({ workspaceId, fetchFn = fetch }: { workspaceId: string; fetchFn?: typeof fetch }) {
  const api = useMemo(() => createApi(fetchFn), [fetchFn])
  const search = useSearchParams()
  const [{ status: filter, channel: channelFilter, q: searchQuery, cursor, post: queryPostId }, setQuery] = useQueryStates(
    contentHubQueryParsers,
    { history: 'push', shallow: true },
  )

  const [items, setItems] = useState<QuickPostItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState<boolean>(false)
  const [prevCursor, setPrevCursor] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [dataKey, setDataKey] = useState('')
  const [detail, setDetail] = useState<{ id: string; state: 'loading' | 'ready' | 'missing' | 'error'; message?: string }>({ id: '', state: 'loading' })
  const [detailRetry, setDetailRetry] = useState(0)
  const [listRevision, setListRevision] = useState(0)
  const requestSequence = useRef(0)
  const hasLoadedList = useRef(false)
  const listController = useRef<AbortController | null>(null)
  const [loadingPage, setLoadingPage] = useState<boolean>(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hasAnySupportedContent, setHasAnySupportedContent] = useState<boolean | null>(null)

  const [, setCredits] = useState<{ available: number | null; draftCost: number } | null>(null)
  const selectedId = queryPostId || null
  const [selectedPostFallback, setSelectedPostFallback] = useState<QuickPostItem | null>(null)
  const [approvalOptions, setApprovalOptions] = useState<QuickPostApprovalOptions | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  const [studioOpen, setStudioOpen] = useState(false)
  const [naverPanelOpen, setNaverPanelOpen] = useState(false)
  const naverPanelOpenerRef = useRef<HTMLElement | null>(null)
  const naverPanelFallbackRef = useRef<HTMLButtonElement | null>(null)
  const [selectedNaverTopic, setSelectedNaverTopic] = useState<string | null>(null)
  const [businessProfile, setBusinessProfile] = useState<{ businessName?: string | null; industry?: string | null } | null>(null)

  const [creating, setCreating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [scope, setScope] = useState<ReviseScope>('both')

  const [localSearch, setLocalSearch] = useState(searchQuery || '')
  const autoComposed = useRef(false)
  const viewedRef = useRef<string | null>(null)
  const runExternalWrite = useExternalWriteGuard()

  // Direct link from My Knowledge CTA: /app/content?studio=four-channel
  useEffect(() => {
    if (search?.get('studio') === 'four-channel') {
      setStudioOpen(true)
    }
  }, [search])

  // Direct link for Naver Blog panel: /app/content?panel=naver
  useEffect(() => {
    if (search?.get('panel') === 'naver') {
      setNaverPanelOpen(true)
    }
  }, [search])

  const base = `/api/workspaces/${workspaceId}/quick-post`
  const parameters = new URLSearchParams({ status: filter })
  if (cursor) parameters.set('cursor', cursor)
  if (channelFilter !== 'all') parameters.set('channel', channelFilter)
  if (searchQuery) parameters.set('q', searchQuery)
  const requestKey = `${base}?${parameters}`
  const activeKey = useRef(requestKey)
  activeKey.current = requestKey
  const isLoading = loadingPage || loadedKey !== requestKey
  const isStale = items !== null && dataKey !== requestKey

  useEffect(() => { setLocalSearch(searchQuery) }, [searchQuery])

  const load = useCallback(async () => {
    if (activeKey.current !== requestKey) return null
    listController.current?.abort()
    const controller = new AbortController()
    listController.current = controller
    const sequence = ++requestSequence.current
    const current = () => !controller.signal.aborted && sequence === requestSequence.current && activeKey.current === requestKey
    setLoadingPage(true)
    setLoadError(null)
    setPageError(null)
    try {
      const data = await api<{
        items: QuickPostItem[]
        nextCursor?: string | null
        prevCursor?: string | null
        hasNextPage?: boolean
        hasAnySupportedContent?: boolean
        credits?: { available: number | null; draftCost: number }
      }>(requestKey, { cache: 'no-store', signal: controller.signal })
      if (!Array.isArray(data.items)) throw new Error('콘텐츠 목록을 확인하지 못했어요.')
      if (!current()) return null
      setDataKey(requestKey)
      hasLoadedList.current = true
      setItems(data.items)
      setNextCursor(data.nextCursor ?? null)
      setPrevCursor(data.prevCursor ?? null)
      setHasNextPage(Boolean(data.hasNextPage))
      setHasAnySupportedContent(typeof data.hasAnySupportedContent === 'boolean' ? data.hasAnySupportedContent : null)
      if (data.credits) setCredits(data.credits)
      return data.items
    } catch (err: any) {
      if (!current()) return null
      setHasAnySupportedContent(null)
      if (hasLoadedList.current) setPageError(err.message)
      else { setLoadError(err.message); setItems([]) }
      return null
    } finally {
      if (current()) { setLoadingPage(false); setLoadedKey(requestKey) }
    }
  }, [api, requestKey])

  useEffect(() => {
    void load()
    return () => { listController.current?.abort() }
  }, [load, listRevision])

  useEffect(() => {
    if (workspaceId) {
      let active = true
      fetchFn(`/api/workspaces/${workspaceId}/profile`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (active && json?.profile?.business) {
            setBusinessProfile({
              businessName: json.profile.business.business_name,
              industry: json.profile.business.industry,
            })
          }
        })
        .catch(() => {})
      return () => {
        active = false
      }
    }
  }, [workspaceId, fetchFn])

  const selectedFromPage = items?.find(item => item.missionId === selectedId)
  const selectedInPage = Boolean(selectedFromPage)
  useEffect(() => {
    if (!selectedId || selectedInPage) return
    const controller = new AbortController()
    setSelectedPostFallback(null)
    setDetail({ id: selectedId, state: 'loading' })
    api<{ item: QuickPostItem }>(`${base}/${encodeURIComponent(selectedId)}`, { cache: 'no-store', signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return
        if (!data.item || data.item.missionId !== selectedId) throw new Error('게시물을 확인하지 못했어요.')
        setSelectedPostFallback(data.item)
        setDetail({ id: selectedId, state: 'ready' })
      })
      .catch((error: Error & { status?: number }) => {
        if (!controller.signal.aborted) setDetail({ id: selectedId, state: error.status === 404 ? 'missing' : 'error', message: error.message })
      })
    return () => controller.abort()
  }, [api, base, selectedId, selectedInPage, detailRetry])

  const create = useCallback(
    async (topic: string) => {
      setCreating(true)
      try {
        const { item } = await api<{ item: QuickPostItem }>(base, { method: 'POST', body: JSON.stringify({ topic }) })
        setItems((prev) => [item, ...(prev ?? [])])
        setSelectedPostFallback(item)
        await setQuery({ post: item.missionId, status: 'waiting', channel: 'all', q: '', cursor: '' })
        toast.success('미리보기가 준비됐어요. 확인해 보세요!')
        setListRevision(value => value + 1)
      } catch (err: any) {
        if (err.code === 'SOHEE_NOT_READY' || err.code === 'QUICK_START_REQUIRED' || err.code === 'CHANNEL_UNRESOLVED') {
          toast.error(err.message, { action: { label: '시작하기', onClick: () => (window.location.href = err.blockers?.[0]?.href ?? '/start') } })
        } else {
          toast.error(err.message)
        }
      } finally {
        setCreating(false)
      }
    },
    [api, base, setQuery],
  )

  // Arriving from the guided start flow (?compose=first) or from the Sohee chat (?compose=<topic>):
  useEffect(() => {
    if (autoComposed.current || items === null || isLoading || loadError || pageError || hasAnySupportedContent === null) return
    const compose = search?.get('compose')?.trim()
    if (!compose) return
    if (compose === 'first') {
      if (hasAnySupportedContent) return
      autoComposed.current = true
      void create('우리 가게 첫 인사')
      return
    }
    autoComposed.current = true
    void create(compose.slice(0, 300))
  }, [hasAnySupportedContent, items, isLoading, loadError, pageError, search, create])

  const visible = useMemo(() => {
    const list = items ?? []
    if (filter === 'all') return list
    return list.filter((i) => (filter === 'waiting' ? stageOf(i.status) !== 'published' : stageOf(i.status) === 'published'))
  }, [items, filter])

  const selected = selectedId
    ? selectedFromPage ?? (selectedPostFallback?.missionId === selectedId ? selectedPostFallback : null)
    : visible[0] ?? null
  const detailState = selectedId && !selected ? (detail.id === selectedId ? detail.state : 'loading') : 'ready'

  useEffect(() => {
    if (!selected || isLoading || isStale || stageOf(selected.status) !== 'waiting') return
    if (selected.supportsApprovalActions === false) {
      setApprovalOptions(null)
      setApprovalError(null)
      return
    }
    const missionId = selected.missionId
    const revision = selected.revision
    let active = true
    setApprovalOptions(null)
    setApprovalError(null)
    void api<QuickPostApprovalOptions>(`${base}/${encodeURIComponent(missionId)}/approval-options`, { cache: 'no-store' })
      .then((options) => { if (active && options.missionId === missionId && options.revision === revision) setApprovalOptions(options) })
      .catch(() => { if (active) setApprovalError('승인 정보를 확인하지 못했어요. 잠시 후 다시 불러와 주세요.') })
    return () => { active = false }
  // Only the selected version and status determine this request; object identity changes on list refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, base, isLoading, isStale, selected?.missionId, selected?.revision, selected?.status, selected?.supportsApprovalActions])

  useEffect(() => {
    if (!selected || isLoading || isStale || stageOf(selected.status) !== 'waiting') return
    const key = `${selected.missionId}:${selected.revision}`
    if (viewedRef.current === key) return
    viewedRef.current = key
    void fetchFn('/api/onboarding/funnel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, event: 'preview_viewed', missionId: selected.missionId, revision: selected.revision }),
    }).catch(() => undefined)
  }, [selected, workspaceId, fetchFn, isLoading, isStale])

  const handleFilterChange = (newFilter: Filter) => { void setQuery({ status: newFilter, cursor: '' }) }
  const handleChannelChange = (newChannel: ChannelFilter) => { void setQuery({ channel: newChannel, cursor: '' }) }
  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void setQuery({ q: localSearch.trim(), cursor: '' })
  }
  const handleSearchClear = () => {
    setLocalSearch('')
    void setQuery({ q: '', cursor: '' })
  }
  const resetFilters = () => { void setQuery({ q: '', channel: 'all', status: 'waiting', cursor: '' }) }
  const navigatePage = (value: string | null) => {
    if (value && !isLoading && !pageError) void setQuery({ cursor: value, post: '' })
  }

  async function revise() {
    if (!selected) return
    setRevising(true)
    try {
      const { item } = await api<{ item: QuickPostItem }>(base, {
        method: 'PATCH',
        body: JSON.stringify({ missionId: selected.missionId, feedback, scope }),
      })
      setItems((prev) => (prev ?? []).map((i) => (i.missionId === item.missionId ? item : i)))
      setSelectedPostFallback(item)
      void setQuery({ post: item.missionId })
      void load()
      setReviseOpen(false)
      setFeedback('')
      toast.success('요청하신 내용을 반영해서 다시 만들었어요.')
      void fetchFn('/api/onboarding/funnel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, event: 'revise_requested', missionId: item.missionId, revision: item.revision }),
      }).catch(() => undefined)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRevising(false)
    }
  }

  async function saveCopies(copies: QuickPostItem['copies']) {
    if (!selected) return
    try {
      const { item } = await api<{ item: QuickPostItem }>(base, {
        method: 'PATCH',
        body: JSON.stringify({ missionId: selected.missionId, copies }),
      })
      setItems((prev) => (prev ?? []).map((i) => (i.missionId === item.missionId ? item : i)))
      setSelectedPostFallback(item)
      void setQuery({ post: item.missionId })
      void load()
      toast.success('직접 고친 내용을 저장했어요.')
    } catch (err: any) {
      toast.error(err.message)
      throw err
    }
  }

  async function retryChannel(channel: 'instagram' | 'threads') {
    if (!selected) return
    const target = selected
    // 재시도도 실제 게시 요청이다. 오프라인이거나 같은 건이 이미 진행 중이면 요청을 내보내지 않는다(ANI-1778).
    const outcome = await runExternalWrite('publish', `first-post:${target.missionId}`, async () => {
      setPublishing(true)
      try {
        const res = await api<{
          success?: boolean
          executionResult?: {
            overallStatus?: string
            receipts?: Record<string, { stage?: string; providerPostId?: string; permalink?: string }>
          }
        }>('/api/missions/first-post/publish/retry', {
          method: 'POST',
          body: JSON.stringify({ missionId: target.missionId, targetChannel: channel }),
        })
        const receipt = res.executionResult?.receipts?.[channel]
        const channelVerified = receipt?.stage === 'EXTERNALLY_VERIFIED'
        const overall = res.executionResult?.overallStatus

        if (channelVerified) {
          if (overall === 'PARTIAL_SUCCESS') {
            toast.warning('해당 채널에 다시 올라갔어요. 아직 남아 있는 채널 결과를 확인해 주세요.')
          } else {
            toast.success('다시 시도해서 올라간 것을 확인했어요.')
          }
        } else {
          toast.error('게시 결과를 확인하지 못했어요. 채널별 결과를 확인해 주세요.')
        }
      } catch (err: any) {
        toast.error(err.message)
      } finally {
        await load()
        setDetailRetry(value => value + 1)
        setPublishing(false)
      }
    })
    if (!outcome.ran) toast.error(outcome.decision.message)
  }

  async function publish() {
    if (!selected) return
    const target = selected
    setPublishOpen(false)
    // 실제 발행은 오프라인이거나 같은 건이 이미 진행 중이면 시작하지 않는다(ANI-1778).
    const outcome = await runExternalWrite('publish', `first-post:${target.missionId}`, async () => {
      setPublishing(true)
      setItems((prev) => (prev ?? []).map((i) => (i.missionId === target.missionId ? { ...i, status: 'EXECUTING' } : i)))
      try {
        if (target.status !== 'APPROVED') {
          await api('/api/missions/first-post/approve', {
            method: 'POST',
            body: JSON.stringify({
              missionId: target.missionId,
              fingerprint: target.approvalFingerprint,
              isExplicitlyApproved: true,
              explicitPhrase: APPROVAL_PHRASE,
            }),
          })
        }
        const res = await api<{ success?: boolean; executionResult?: { overallStatus: string } }>('/api/missions/first-post/publish', {
          method: 'POST',
          body: JSON.stringify({ missionId: target.missionId }),
        })
        const overall = res.executionResult?.overallStatus
        if (overall === 'ALL_VERIFIED') toast.success('발행 완료! 실제로 올라간 것까지 확인했어요 🎉')
        else if (overall === 'PARTIAL_SUCCESS') toast.warning('일부 채널에만 올라갔어요. 아래에서 확인해 주세요.')
        else toast.error('발행하지 못했어요. 아래 안내를 확인해 주세요.')
      } catch (err: any) {
        toast.error(err.message)
      } finally {
        await load()
        setDetailRetry(value => value + 1)
        setPublishing(false)
      }
    })
    if (!outcome.ran) toast.error(outcome.decision.message)
  }

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">콘텐츠</h1>
        <p className="text-sm text-muted-foreground">소희가 만든 글과 사진이 채널에서 어떻게 보일지 예상 화면으로 확인하고, 마음에 들 때만 발행해요.</p>
      </header>

      {/* Studio & Publish Entries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 4-Channel Studio Entry */}
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/5 via-background to-primary/5 p-4 sm:p-5 shadow-xs">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold tracking-tight shrink-0 whitespace-nowrap">4채널 글 만들기</h2>
              <Badge variant="outline" className="shrink-0 border-primary/40 text-primary whitespace-nowrap">신규</Badge>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground break-keep">
              가게 지식을 바탕으로 인스타그램, 스레드, 네이버 블로그, 당근 비즈프로필 맞춤 글을 한 번에 만들고 예상 화면으로 확인하세요.
            </p>
          </div>
          <div className="pt-1">
            <Button
              type="button"
              onClick={() => setStudioOpen((prev) => !prev)}
              className="w-full sm:w-auto shrink-0 min-h-[44px] font-medium"
            >
              {studioOpen ? '스튜디오 접기' : '4채널 글 만들기'}
            </Button>
          </div>
        </div>

        {/* Naver Blog Publish Entry */}
        <div className="flex flex-col justify-between gap-3.5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-background to-emerald-500/5 p-4 sm:p-5 shadow-xs transition-all hover:border-emerald-500/50">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#03C75A] text-white font-extrabold text-xs shadow-2xs">N</span>
                <h2 className="text-base sm:text-lg font-bold tracking-tight shrink-0 whitespace-nowrap">네이버 블로그 글쓰기</h2>
                <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 whitespace-nowrap">원고·사진 준비</Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground break-keep">
                주제만 알려 주시면 소희가 글과 사진을 만들어요. 검토한 원고와 사진을 내려받아 네이버 편집기에서 직접 게시해 주세요.
              </p>
            </div>
            <Button
              type="button"
              ref={naverPanelFallbackRef}
              onClick={(event) => {
                naverPanelOpenerRef.current = event.currentTarget
                setSelectedNaverTopic(null)
                setNaverPanelOpen(true)
              }}
              className="w-full xl:w-auto shrink-0 min-h-[44px] font-medium bg-[#03C75A] hover:bg-[#03C75A]/90 text-white shadow-xs"
            >
              네이버 글쓰기
            </Button>
          </div>

          {/* Quick Recommendation Chips */}
          <div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Sparkles className="size-3.5 text-emerald-600" aria-hidden />
              빠른 추천 글감:
            </span>
            {[
              {
                label: '🏡 매장 소개와 방문 안내',
                prompt: `${businessProfile?.businessName?.trim() || '우리 매장'}의 확인된 매장 정보만 바탕으로 공간과 방문 방법을 소개하는 글. 확인되지 않은 평점·후기·효능은 만들지 않기 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
              },
              {
                label: `🍁 ${businessProfile?.businessName?.trim() || '우리 매장'} 이야기`,
                prompt: `${businessProfile?.businessName?.trim() || '우리 매장'}의 정성스러운 공간과 고객을 향한 철학 이야기 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
              },
              {
                label: `⏰ ${businessProfile?.industry?.trim() || '매장'} 일상 노하우`,
                prompt: `${businessProfile?.industry?.trim() || '매장'} 일상에서 유용한 관리 팁과 실용적인 노하우 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
              },
              {
                label: '🌿 1:1 맞춤 공간 & 방문 안내',
                prompt: `처음 방문하시는 분들을 위한 ${businessProfile?.businessName?.trim() || '우리 매장'} 공간과 맞춤 방문 순서 안내 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`,
              },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={(event) => {
                  naverPanelOpenerRef.current = event.currentTarget
                  setSelectedNaverTopic(chip.prompt)
                  setNaverPanelOpen(true)
                  toast.success(`✨ 추천 글감 [${chip.label}]이 적용되었어요!`)
                }}
                className="text-xs px-2.5 py-1 rounded-full border border-emerald-500/25 bg-background hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-colors font-medium text-foreground cursor-pointer"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live-only tool: isolated fixture requests must not fall through to other APIs. */}
      {fetchFn === fetch && <div className="pt-1">
        <NaverPlaceConnectCard
          workspaceId={workspaceId}
          onStartSnsCard={(syncedPlace) => {
            const store = syncedPlace?.name || businessProfile?.businessName?.trim() || '우리 매장'
            void create(`${store}의 확인된 매장 정보만 바탕으로 공간과 방문 방법을 소개하는 카드뉴스. 확인되지 않은 평점·후기·효능은 만들지 않기`)
          }}
          onStartBlogPost={(syncedPlace) => {
            const store = syncedPlace?.name || businessProfile?.businessName?.trim() || '우리 매장'
            // No event here: fall back to whatever the user just activated, then to the header entry button.
            const active = document.activeElement
            naverPanelOpenerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
            setSelectedNaverTopic(`${store}의 확인된 매장 정보만 바탕으로 공간과 방문 방법을 소개하는 글. 확인되지 않은 평점·후기·효능은 만들지 않기 (가격 할인 이벤트 쿠폰 무료 혜택 영업시간 효과 치료 최고 단어 제외)`)
            setNaverPanelOpen(true)
          }}
        />
      </div>}

      <Sheet open={naverPanelOpen} onOpenChange={setNaverPanelOpen}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="w-full sm:max-w-2xl p-0 h-full overflow-hidden"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opener = naverPanelOpenerRef.current
            const fallback = naverPanelFallbackRef.current
            naverPanelOpenerRef.current = null
            const target = (opener?.isConnected ? opener : null) ?? (fallback?.isConnected ? fallback : null)
            target?.focus()
          }}
        >
          <SheetTitle className="sr-only">네이버 블로그 글 작성</SheetTitle>
          <NaverPostPanel
            workspaceId={workspaceId}
            open={naverPanelOpen}
            onClose={() => setNaverPanelOpen(false)}
            initialTopic={selectedNaverTopic}
            businessProfile={businessProfile}
          />
        </SheetContent>
      </Sheet>

      {studioOpen && (
        <div className="pt-1">
          <FourChannelStudio workspaceId={workspaceId} onClose={() => setStudioOpen(false)} />
        </div>
      )}

      <ComposerCard busy={creating} onCreate={create} />

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw aria-hidden /> 다시 불러오기
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside aria-label="게시물 목록" className="space-y-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
            {/* 1. 상태 탭 */}
            <div role="tablist" aria-label="게시물 보기 필터" className="grid grid-cols-3 rounded-lg border bg-muted p-1 text-sm">
              {([
                ['waiting', '확인 필요'],
                ['published', '발행됨'],
                ['all', '전체'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={filter === key}
                  tabIndex={filter === key ? 0 : -1}
                  onKeyDown={event => {
                    const keys: Filter[] = ['waiting', 'published', 'all']
                    const index = keys.indexOf(key)
                    const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null
                    if (next === null) return
                    event.preventDefault()
                    handleFilterChange(keys[next])
                    const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
                    target?.focus()
                  }}
                  onClick={() => handleFilterChange(key)}
                  className={cn(
                    'min-h-11 rounded-md px-2 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 2. 채널 필터 및 검색창 */}
            <div className="space-y-2">
              <form onSubmit={handleSearchSubmit} className="relative flex items-center">
                <Input
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  placeholder="주제 및 문구 검색..."
                  className="h-11 pr-24 text-sm"
                  maxLength={200}
                  aria-label="게시물 검색"
                />
                <div className="absolute right-1 flex items-center gap-0.5">
                  {localSearch && (
                    <button
                      type="button"
                      onClick={handleSearchClear}
                      className="grid size-11 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="검색어 지우기"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  <button type="submit" className="grid size-11 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="검색">
                    <Search className="size-3.5" />
                  </button>
                </div>
              </form>

              <div role="group" aria-label="저장된 연결 채널 필터" className="flex flex-wrap items-center gap-1 text-xs">
                {([
                  ['all', '모든 채널'],
                  ['instagram', '인스타그램'],
                  ['threads', '스레드'],
                ] as const).map(([cKey, cLabel]) => (
                  <button
                    key={cKey}
                    type="button"
                    aria-pressed={channelFilter === cKey}
                    onClick={() => handleChannelChange(cKey)}
                    className={cn(
                      'min-h-11 rounded-md border px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      channelFilter === cKey ? 'border-primary bg-accent/60 font-medium' : 'border-border text-muted-foreground hover:bg-accent/30',
                    )}
                  >
                    {cLabel}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">만들 때 저장된 연결 채널 기준이에요. 실제 발행 결과와는 달라요.</p>
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>필터 초기화</Button>
            {isLoading && <p role="status" className="text-sm text-muted-foreground">{items === null ? '게시물을 불러오고 있어요.' : '검색 중 · 이전 결과를 표시하고 있어요.'}</p>}
            {!isLoading && isStale && pageError && <p className="text-sm text-muted-foreground">이전 결과를 표시하고 있어요. 다시 조회하거나 필터를 초기화해 주세요.</p>}
            {/* 3. 목록 표시 */}
            {pageError && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive flex items-center justify-between">
                <span>{pageError}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>페이지 다시 시도</Button>
              </div>
            )}

            <ul className="space-y-2" aria-busy={isLoading}>
              {items === null && !loadError && <li><Skeleton className="h-40" /></li>}
              {!isLoading && !loadError && !pageError && visible.length === 0 && (
                <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {hasAnySupportedContent === false && !searchQuery && channelFilter === 'all'
                    ? <EmptyState area="content" />
                    : '검색 조건에 맞는 게시물이 없어요.'}
                </li>
              )}
              {visible.map((item) => {
                const stage = stageOf(item.status)
                const active = selected?.missionId === item.missionId
                return (
                  <li key={item.missionId}>
                    <button
                      type="button"
                      onClick={() => {
                        void setQuery({ post: item.missionId })
                      }}
                      aria-current={active}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active && 'border-primary bg-accent/50',
                      )}
                    >
                      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium">{item.topic || item.copies.threads.content.slice(0, 40)}</span>
                        <span className="mt-1 flex items-center gap-1.5">
                          <Badge variant={stage === 'published' ? 'success' : stage === 'failed' ? 'destructive' : 'purple'}>{STAGE_LABEL[stage]}</Badge>
                          <span className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* 4. 복합 커서 페이지네이션 네비게이션 */}
            <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigatePage(prevCursor)}
                aria-label="이전 페이지"
                disabled={!prevCursor || isLoading || Boolean(pageError)}
                className="h-8 gap-1 text-xs"
              >
                <ChevronLeft className="size-3.5" /> 이전
              </Button>
              <span>{visible.length > 0 ? `현재 페이지 ${visible.length}건` : ''}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigatePage(nextCursor)}
                aria-label="다음 페이지"
                disabled={!hasNextPage || isLoading || Boolean(pageError)}
                className="h-8 gap-1 text-xs"
              >
                다음 <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </aside>

          <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
            {selectedId && !selected ? (
              <div className="space-y-3 py-8 text-sm" role={detailState === 'loading' ? 'status' : 'alert'}>
                <p>{detailState === 'loading' ? '게시물을 불러오고 있어요.' : detail.message ?? '게시물을 확인하지 못했어요.'}</p>
                {detailState === 'error' && <Button variant="outline" onClick={() => setDetailRetry(value => value + 1)}>상세 다시 시도</Button>}
                <Button variant="ghost" onClick={() => void setQuery({ post: '' })}>선택 해제</Button>
              </div>
            ) : selected ? (
              <>
              {selectedId && !visible.some(item => item.missionId === selectedId) && <p className="mb-3 text-sm text-muted-foreground">현재 검색 조건 밖의 게시물을 보고 있어요.</p>}
              <PostDetail
                item={selected}
                workspaceId={workspaceId}
                approvalOptions={approvalOptions?.missionId === selected.missionId ? approvalOptions : null}
                approvalError={approvalError}
                busy={publishing || revising || isLoading || isStale}
                onRevise={() => setReviseOpen(true)}
                onPublish={() => setPublishOpen(true)}
                onSaveCopies={saveCopies}
                onRetry={retryChannel}
              />
              </>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">왼쪽에서 게시물을 선택해 주세요.</p>
            )}
          </div>
        </div>

      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>어떤 점을 바꿀까요?</DialogTitle>
            <DialogDescription>편하게 말씀해 주세요. 소희가 반영해서 다시 만들어 드려요.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div role="radiogroup" aria-label="수정 범위" className="grid grid-cols-3 gap-2 text-sm">
              {([
                ['text', '글만'],
                ['image', '사진만'],
                ['both', '둘 다'],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={scope === k}
                  onClick={() => setScope(k)}
                  className={cn('rounded-lg border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', scope === k ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
                >
                  {label}
                </button>
              ))}
            </div>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              maxLength={300}
              placeholder="예: 조금 더 담백하게, 사진은 매장 안쪽 분위기로 바꿔 주세요"
              aria-label="수정 요청 내용"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviseOpen(false)}>
              취소
            </Button>
            <Button onClick={revise} disabled={revising || !feedback.trim()}>
              {revising && <Loader2 className="animate-spin" aria-hidden />} 다시 만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 모습 그대로 발행할까요?</DialogTitle>
            <DialogDescription>
              {selected?.channels.map((c) => (c.provider === 'instagram' ? '인스타그램' : '스레드')).join(' · ')} 계정에 바로 올라가요. 발행 후에는 소희가 실제로 올라갔는지 다시 확인해요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              아직 더 볼게요
            </Button>
            <Button onClick={publish}>
              <Rocket aria-hidden /> 네, 발행합니다
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ContentHub() {
  const context = useOptionalWorkspaceContext()
  const workspaceId = context?.workspaceId && context.workspaceId !== 'ws-default' ? context.workspaceId : null
  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-10 text-center">
        <p className="font-semibold">로그인이 필요해요</p>
        <p className="text-sm text-muted-foreground">로그인하면 소희가 만든 게시물을 확인할 수 있어요.</p>
        <Button asChild>
          <Link href="/login?next=/app/content">로그인하기</Link>
        </Button>
      </div>
    )
  }
  return (
    <V088AppShell workspaceId={workspaceId}>
      <ContentHubWorkspace key={workspaceId} workspaceId={workspaceId} />
    </V088AppShell>
  )
}
