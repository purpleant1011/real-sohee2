'use client'

import React, { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { MarketingCalendar } from '@/components/v088/calendar/marketing-calendar'
import { ContentDetailModal, type FullContentDetail } from '@/components/v088/content/content-detail-modal'
import { parseContentApiResponse, type ContentViewState } from '@/features/content/content-view-state'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { 
  FileText, 
  Calendar as CalendarIcon, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  Eye, 
  Filter, 
  Plus, 
  MessageSquare, 
  Share2,
  TrendingUp,
  Target,
  Search,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Sliders,
  BookOpen,
  Zap,
  Layers,
  Image as ImageIcon,
  Check,
  CalendarCheck,
  Send,
  ShieldCheck,
  X,
  Copy,
  Info,
  ArrowRight,
  Globe,
  AlertTriangle,
  RotateCw,
  Radio,
  SlidersHorizontal,
  Camera
} from 'lucide-react'
import { AgentStateBadge } from '@/components/v088/agent-state-badge'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { ContentProductionPipeline } from '@/components/v088/content/content-production-pipeline'
import { ContentStudioRenewal } from '@/components/content/content-studio-renewal'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { useCreditBalance } from '@/hooks/use-credit-balance'

// 6 Visual-First Eyebrow Tattoo & Beauty Knowledge Harnesses
export interface VisualKnowledgeHarness {
  id: string
  title: string
  platform: string
  version: string
  sourceUrl: string
  sourceHandle: string
  status: string
  badgeColor: string
  lookbookImages: string[] // Scraped representative lookbook images from Instagram
  coreDna: string[]
  moduleReadiness: {
    text: string
    visual: string
    operations: string
    community: string
    platform: string
  }
  dailyEstimatedSc: number
  toneVector: {
    professional: number
    empathy: number
    directness: number
    urgency: number
  }
  paragraphRhythm: string
  sentenceLengthProfile: string
  rules: {
    title: string
    content: string
    type: 'OBSERVED' | 'RECOMMENDED_DEFAULT'
    confidence: string
    evidence: string
  }[]
}

export default function ContentPage() {
  const workspaceId = useWorkspaceId()
  const { balance, consumeCredits } = useCreditBalance(workspaceId)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const [mounted, setMounted] = useState(false)
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [businessCategory, setBusinessCategory] = useState('비즈니스')
  const [viewMode, setViewMode] = useState<'studio' | 'both' | 'pipeline' | 'calendar'>('studio')
  const [registeredHarnesses, setRegisteredHarnesses] = useState<VisualKnowledgeHarness[]>([])
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>('')
  const [inspectingHarness, setInspectingHarness] = useState<VisualKnowledgeHarness | null>(null)
  const [inspectorTab, setInspectorTab] = useState<'overview' | 'rules' | 'evidence' | 'channels' | 'performance' | 'history' | 'override' | 'credits'>('overview')
  const [targetChannel, setTargetChannel] = useState<'naver' | 'instagram' | 'daangn' | 'threads'>('naver')
  const [imageStyle, setImageStyle] = useState<'lookbook' | 'infographic' | 'story'>('lookbook')
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedContent, setSelectedContent] = useState<FullContentDetail | null>(null)
  const [contentList, setContentList] = useState<FullContentDetail[]>([])
  const [contentViewState, setContentViewState] = useState<ContentViewState>({ status: 'LOADING' })
  // 발행 가드가 막았을 때 이유를 화면에 남긴다(ANI-1778). 실패 상태로 덮지 않는다.
  const [publishBlockMessage, setPublishBlockMessage] = useState<string | null>(null)
  const runExternalWrite = useExternalWriteGuard()

  const loadWorkspaceContents = async () => {
    if (!workspaceId) return
    setContentViewState({ status: 'LOADING' })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/content?_t=${Date.now()}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        const errorMessage = errJson?.error?.message || `콘텐츠 목록을 불러오지 못했습니다. (HTTP ${res.status})`
        setContentViewState({ status: 'ERROR', errorMessage })
        setContentList([])
        return
      }
      const data = await res.json()
      const parsed = parseContentApiResponse(data, workspaceId)
      setContentViewState(parsed)
      if (parsed.status === 'DATA') {
        setContentList(parsed.items)
      } else {
        setContentList([])
      }
    } catch (err: any) {
      console.error('Failed to load canonical workspace contents:', err)
      setContentViewState({
        status: 'ERROR',
        errorMessage: err.message || '네트워크 오류로 콘텐츠를 불러오지 못했습니다.',
      })
      setContentList([])
    }
  }

  useEffect(() => {
    setMounted(true)
    loadWorkspaceContents()
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then((res: any) => {
        if (res.data?.user?.email === 'test@example.com') {
          setIsTestAccount(true)
        } else {
          setIsTestAccount(false)
          if (res.data?.user) {
            supabase
              .from('business_profiles')
              .select('*')
              .limit(1)
              .maybeSingle()
              .then((pRes: any) => {
                if (pRes.data?.category) setBusinessCategory(pRes.data.category)
              })
          }
        }
      })
    } catch {}
  }, [workspaceId])

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 380
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  // Handle Harness-Driven Content Generation (Durable SSOT)
  const handleGenerateContent = async (customHarnessId?: string) => {
    const harnessToUse = registeredHarnesses.find(h => h.id === (customHarnessId || selectedHarnessId)) || registeredHarnesses[0]
    if (!harnessToUse) {
      alert('선택 가능한 스타일 기준이 없습니다. 스타일 기준을 먼저 등록해주세요.')
      return
    }
    setIsGenerating(true)
    consumeCredits(120)

    const channelMap = targetChannel === 'naver' ? 'naver_blog' : targetChannel === 'threads' ? 'threads' : 'instagram'
    const title = `${harnessToUse.title.split(' ')[0]} 기반 맞춤형 룩북`
    const caption = `${harnessToUse.coreDna.join('\n')}\n\n${title} 콘텐츠입니다.`
    const hashtags = ['#매장소식', '#소희AI']

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelMap,
          title,
          caption,
          hashtags,
          mediaUrls: harnessToUse.lookbookImages.slice(0, 2),
        }),
      })
      const data = await res.json()
      if (data.success && data.content) {
        const created: FullContentDetail = {
          id: data.content.contentId,
          title,
          channel: targetChannel,
          category: targetChannel === 'naver' ? 'column' : 'feed',
          state: 'waiting_for_approval',
          scheduledDate: '오늘',
          qcScore: 98,
          inquiryGoal: '방문 및 문의 유치',
          targetKeyword: '#매장소식',
          harnessName: harnessToUse.title,
          images: harnessToUse.lookbookImages.slice(0, 2),
          bodyContent: caption,
          hashtags,
          versionId: data.content.versionId,
          versionNumber: 1,
          fingerprint: data.content.fingerprint,
          isApproved: false,
          isPublished: false,
        }
        setContentList([created, ...contentList])
        setSelectedContent(created)
      }
    } catch (err) {
      console.error('Failed to create canonical content:', err)
    } finally {
      setIsGenerating(false)
      if (inspectingHarness) setInspectingHarness(null)
    }
  }

  const handlePublishNow = async (id: string) => {
    const targetItem = contentList.find(c => c.id === id)
    if (!targetItem) return

    setPublishBlockMessage(null)
    const submit = async () => {
      try {
        // 1. Ensure Approval First (ANI-1043)
        let approvalId = targetItem.approvalId
        if (!targetItem.isApproved && targetItem.id && targetItem.versionId && targetItem.fingerprint) {
          const appRes = await fetch(`/api/workspaces/${workspaceId}/content/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentId: targetItem.id,
              versionId: targetItem.versionId,
              fingerprint: targetItem.fingerprint,
              reason: '패널에서 사장님 직접 승인 및 발행',
            }),
          })
          const appData = await appRes.json()
          if (!appRes.ok || !appData.success) {
            throw new Error(appData.error?.message || '원고 승인 처리에 실패했습니다.')
          }
          approvalId = appData.approval?.approvalId
        }

        const res = await fetch(`/api/workspaces/${workspaceId}/publishing/instant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: targetItem.channel === 'naver' ? 'NAVER_BLOG' : targetItem.channel === 'threads' ? 'THREADS' : 'INSTAGRAM',
            title: targetItem.title,
            caption: targetItem.bodyContent || targetItem.title,
            images: targetItem.images || [],
            hashtags: targetItem.hashtags || [],
            approvalId,
            contentId: targetItem.id,
            versionId: targetItem.versionId,
            fingerprint: targetItem.fingerprint,
          })
        })

        const data = await res.json()
        const publishResult = data.results?.instagram || data.results?.naver || data.results?.threads

        setContentList(prev => prev.map(c => {
          if (c.id === id) {
            return {
              ...c,
              state: publishResult?.success ? 'completed' : 'failed',
              isPublished: Boolean(publishResult?.success),
              publishedUrl: publishResult?.url || c.publishedUrl || '',
              isApproved: true,
              approvalId,
            }
          }
          return c
        }))
      } catch {
        setContentList(prev => prev.map(c => c.id === id ? { ...c, state: 'failed', isPublished: false } : c))
      }
    }

    // 발행은 외부 쓰기다 — 오프라인이거나 같은 원고 발행이 이미 진행 중이면 요청을 내보내지 않는다(ANI-1778).
    // 승인 POST 와 발행 POST 를 한 작업으로 묶어, 승인만 나가고 발행이 막히는 중간 상태를 만들지 않는다.
    const outcome = await runExternalWrite('publish', `content:${id}`, submit)
    if (!outcome.ran) setPublishBlockMessage(outcome.decision.message)
  }

  const handleScheduleDate = (id: string, dateStr: string) => {
    setContentList(prev => prev.map(c => {
      if (c.id === id) {
        return {
          ...c,
          state: 'scheduled',
          scheduledDate: dateStr
        }
      }
      return c
    }))
  }

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* 발행이 막힌 이유(오프라인·중복)를 조용히 실패로 덮지 않고 알린다(ANI-1778). */}
        {publishBlockMessage && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-xl border border-state-warn/30 bg-state-warn-soft p-3 text-xs font-semibold text-state-warn"
          >
            <span>{publishBlockMessage}</span>
            <button
              type="button"
              onClick={() => setPublishBlockMessage(null)}
              aria-label="안내 닫기"
              className="shrink-0 rounded-md p-1 hover:bg-state-warn/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Studio View Mode Switcher */}
        <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => setViewMode('studio')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer min-h-11 inline-flex items-center justify-center ${
              viewMode === 'studio'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            V0.91 결과 중심 스튜디오
          </button>
          <button
            type="button"
            onClick={() => setViewMode('both')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer min-h-11 inline-flex items-center justify-center ${
              viewMode !== 'studio'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            기존 상세 파이프라인/캘린더
          </button>
        </div>

        {viewMode === 'studio' ? (
          <ContentStudioRenewal workspaceId={workspaceId} />
        ) : (
          <>
            {/* Sohee Live Workboard (Figma 32:2412) */}
            <SoheeLiveWorkboard workspaceId={workspaceId} />

            {/* 1. 🌟 [Chat-Native Content Production Studio Pipeline] */}
            <ContentProductionPipeline workspaceId={workspaceId} />

        {/* Setup Bridge Header */}
        <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                소희의 모든 콘텐츠와 이미지는 [나의 소희 ➔ 비법 교육 (스타일 기준)]에 등록된 6대 정본 룩북 지식을 기반으로 제작됩니다.
              </div>
              <div className="text-[11px] text-zinc-500">
                실제 인스타그램에서 스크래핑된 대표 룩북 갤러리를 확인하고 원하는 스타일 기준을 가로로 넘겨 선택하세요.
              </div>
            </div>
          </div>
          <Link
            href="/app/sohee?tab=training"
            className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-bold text-primary hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>비법 교육 & 톤 셋업</span>
          </Link>
        </div>

        {/* 2. 🌟 [Creative Inputs: 6대 비주얼 룩북 가로 스크롤 캐러셀] */}
        <div className="p-6 md:p-7 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30 flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  <span>Creative Inputs · {isTestAccount ? '6대 전문 스타일 기준' : '매장 맞춤 스타일 기준'}</span>
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                크리에이티브 인풋 & 대표 룩북 이미지 참조
              </h2>
              <p className="text-xs text-zinc-500 mt-1 font-medium">
                {isTestAccount
                  ? '실제 스크래핑된 대표 시술 사진과 디자인 무드를 확인하고, 원하는 느낌의 스타일을 가로로 스크롤하여 선택하세요.'
                  : '사장님 매장만의 대표 스타일과 가격표, 시술 사진을 매장 기준으로 등록하고 AI 콘텐츠를 생성하세요.'}
              </p>
            </div>

            {/* Carousel Navigation Arrows */}
            <div className="flex items-center gap-2">
              {isTestAccount && (
                <>
                  <button
                    onClick={() => scrollCarousel('left')}
                    className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer shadow-2xs min-h-11 min-w-11 inline-flex items-center justify-center"
                    title="왼쪽으로 스크롤"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => scrollCarousel('right')}
                    className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer shadow-2xs min-h-11 min-w-11 inline-flex items-center justify-center"
                    title="오른쪽으로 스크롤"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
              <Link
                href="/app/sohee?tab=training"
                className="ml-2 text-xs font-bold text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>새 스타일 기준 추가</span>
              </Link>
            </div>
          </div>

          {/* 🌟 Horizontal Scrollable Carousel or Clean Slate */}
          {registeredHarnesses.length > 0 ? (
            <div className="relative">
              <div
                ref={scrollContainerRef}
                className="flex items-stretch gap-4.5 overflow-x-auto pb-3 pt-1 scroll-smooth snap-x snap-mandatory no-scrollbar"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {registeredHarnesses.map((harness) => {
                  const isSelected = selectedHarnessId === harness.id
                  return (
                    <div
                      key={harness.id}
                      onClick={() => setSelectedHarnessId(harness.id)}
                      className={`min-w-[340px] max-w-[360px] p-5 rounded-3xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-4 shrink-0 snap-start select-none ${
                        isSelected
                          ? 'border-primary/30 bg-primary/30 ring-2 ring-primary/20 shadow-lg'
                          : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 hover:border-zinc-300 hover:shadow-md'
                      }`}
                    >
                      <div className="space-y-3.5">
                        {/* Top Meta & Status */}
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 flex items-center gap-1">
                            <Globe className="w-3 h-3" /> {harness.platform}
                          </span>

                          {isSelected ? (
                            <span className="flex items-center gap-1 text-[11px] font-extrabold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/30">
                              <Check className="w-3.5 h-3.5" /> 선택됨
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-state-ok">
                              ● {harness.status.split(' ')[0]}
                            </span>
                          )}
                        </div>

                        {/* Lookbook Image */}
                        <div className="space-y-1.5">
                          <div className="relative h-28 rounded-2xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800 group bg-zinc-100 dark:bg-zinc-800">
                            <img
                              src={harness.lookbookImages[0]}
                              alt="대표 룩북 시안"
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-2.5">
                              <span className="text-[10px] font-extrabold text-white bg-black/50 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/20 flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-primary" />
                                <span>AI 시안 스타일 프리뷰</span>
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 h-12">
                            {harness.lookbookImages.slice(1, 4).map((imgUrl, imgIdx) => (
                              <div key={imgIdx} className="relative rounded-xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 group">
                                <img
                                  src={imgUrl}
                                  alt={`룩북 서브 ${imgIdx + 1}`}
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Title & Link */}
                        <div>
                          <h3 className="text-sm font-black text-zinc-950 dark:text-zinc-50 leading-snug line-clamp-2">
                            {harness.title}
                          </h3>
                          <span className="text-[11px] text-zinc-400 font-mono mt-0.5 block truncate">
                            🔗 {harness.sourceUrl}
                          </span>
                        </div>

                        {/* 3대 핵심 DNA */}
                        <div className="space-y-1 pt-1">
                          {harness.coreDna.slice(0, 2).map((dna, idx) => (
                            <div key={idx} className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                              <span className="text-primary font-black font-mono">#{idx + 1}</span>
                              <span className="truncate">{dna}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end text-xs">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setInspectingHarness(harness)
                          }}
                          className="font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer text-xs"
                        >
                          <span>🔍 심층 지식 열람</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-dashed border-zinc-300 dark:border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    우리 매장만의 비법 스타일 등록하기
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 max-w-lg leading-relaxed">
                  사장님 매장만의 사진, 가격표, 시술 스타일을 등록하면 소희가 우리 매장만의 고유한 어투와 디자인으로 AI 콘텐츠를 제작합니다.
                </p>
              </div>
              <Link
                href="/app/sohee?tab=training"
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all shrink-0 shadow-xs flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>내 매장 스타일 기준 만들기</span>
              </Link>
            </div>
          )}

          {/* Channel & Image Style Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
                2. 배포 타깃 채널:
              </span>
              <div className="grid grid-cols-4 gap-2 text-xs font-bold">
                {[
                  { id: 'naver', label: '네이버 블로그' },
                  { id: 'instagram', label: '인스타그램' },
                  { id: 'daangn', label: '당근마켓' },
                  { id: 'threads', label: '스레드' },
                ].map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => setTargetChannel(ch.id as any)}
                    className={`py-2.5 rounded-xl border transition-all cursor-pointer text-center ${
                      targetChannel === ch.id
                        ? 'bg-primary text-primary-foreground border-primary/30 shadow-2xs'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100'
                    }`}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
                3. 이미지 & 룩북 생성 스타일:
              </span>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                {[
                  { id: 'lookbook', label: '시술 전후 룩북 4컷' },
                  { id: 'infographic', label: '상담 가이드 카드' },
                  { id: 'story', label: '감성 스토리 무드' },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setImageStyle(st.id as any)}
                    className={`py-2.5 rounded-xl border transition-all cursor-pointer text-center ${
                      imageStyle === st.id
                        ? 'bg-primary text-primary-foreground border-primary/30 shadow-2xs'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Trigger Button */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-zinc-500 font-medium">
              * 선택된 스타일 기준의 실제 룩북 스타일과 3대 DNA를 반영하여 고화질 시안과 원고를 즉시 생성해 발행 대기열에 등록합니다.
            </div>

            <button
              onClick={() => handleGenerateContent()}
              disabled={isGenerating || (balance !== null && balance < 10)}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-extrabold text-xs transition-all shadow-md ${
                balance !== null && balance < 10
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait text-white shadow-primary/25 cursor-pointer'
              }`}
            >
              <Zap className="w-4 h-4 text-state-warn fill-state-warn" />
              <span>
                {isGenerating
                  ? '스타일 룩북 기반 AI 생성 중...'
                  : balance !== null && balance < 10
                  ? '이용 한도에 도달했어요'
                  : '✨ 선택한 스타일 기준으로 AI 콘텐츠 & 이미지 생성'}
              </span>
            </button>
          </div>
        </div>

        {/* 2. 🚀 [주간 마케팅 콘텐츠 발행 대기열 (Harness Publishing Queue)] */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                <span>주간 마케팅 콘텐츠 발행 대기열 ({contentList.length}건)</span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-medium">
                생성된 콘텐츠 카드를 클릭하면 각 플랫폼별 실사 UI 미리보기가 열리며, SNS 즉시 발행·예약 또는 블로그·당근 원고 복사를 진행할 수 있습니다.
              </p>
            </div>

            <div className="flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold">
              <button
                onClick={() => setViewMode('both')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-11 inline-flex items-center justify-center ${
                  viewMode === 'both' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-2xs' : 'text-zinc-500'
                }`}
              >
                전체 통합 뷰
              </button>
              <button
                onClick={() => setViewMode('pipeline')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-11 inline-flex items-center justify-center ${
                  viewMode === 'pipeline' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-2xs' : 'text-zinc-500'
                }`}
              >
                대기열만
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-11 inline-flex items-center justify-center ${
                  viewMode === 'calendar' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-2xs' : 'text-zinc-500'
                }`}
              >
                마케팅 캘린더
              </button>
            </div>
          </div>

          {/* Queue Grid Cards with Strict State Separation (ANI-1190, ANI-1208, ANI-1209) */}
          {(viewMode === 'both' || viewMode === 'pipeline') && (
            contentViewState.status === 'LOADING' ? (
              <div className="p-12 text-center rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                <div className="w-10 h-10 mx-auto text-primary animate-spin flex items-center justify-center">
                  <RotateCw className="w-6 h-6" />
                </div>
                <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  작업공간의 마케팅 콘텐츠를 안전하게 불러오는 중입니다...
                </p>
              </div>
            ) : contentViewState.status === 'ERROR' ? (
              <div className="p-8 text-center rounded-3xl bg-state-danger-soft/50 border border-state-danger/30 space-y-3">
                <div className="w-10 h-10 mx-auto rounded-xl bg-state-danger-soft text-state-danger flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-state-danger">
                    콘텐츠를 불러오는 중 문제가 발생했습니다
                  </h3>
                  <p className="text-xs text-state-danger">
                    {contentViewState.errorMessage}
                  </p>
                </div>
                <button
                  onClick={() => loadWorkspaceContents()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-state-danger/30 text-xs font-bold text-state-danger hover:bg-state-danger-soft/50 transition-all cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>다시 시도</span>
                </button>
              </div>
            ) : contentViewState.status === 'EMPTY' ? (
              <div className="p-12 text-center rounded-3xl bg-white dark:bg-[#121215] border border-dashed border-zinc-300 dark:border-zinc-800 space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-inner">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div className="max-w-md mx-auto space-y-1.5">
                  <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                    아직 생성된 마케팅 콘텐츠가 없습니다
                  </h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    상단의 스타일 기준을 선택하고 <b>[AI 마케팅 원고 즉시 생성]</b> 버튼을 누르면, 사장님의 업종({businessCategory})에 맞춤화된 고품질 게시물이 자동으로 기획·생성됩니다.
                  </p>
                </div>
                <button
                  onClick={() => handleGenerateContent()}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-primary to-state-wait text-white font-bold text-xs shadow-md hover:from-primary hover:to-state-wait transition-all cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isGenerating ? 'AI 콘텐츠 생성 중...' : '소희에게 첫 마케팅 콘텐츠 생성 지시하기'}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {contentList.map((cnt) => {
                  const isNaver = cnt.channel === 'naver'
                  const isInsta = cnt.channel === 'instagram'
                  const isDaangn = cnt.channel === 'daangn'

                  return (
                    <div
                      key={cnt.id}
                      onClick={() => setSelectedContent(cnt)}
                      className="p-5 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-4 group"
                    >
                      <div className="space-y-3">
                        {/* Channel Badge & State */}
                        <div className="flex items-center justify-between">
                          <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                            isNaver ? 'bg-state-ok-soft text-state-ok' :
                            isInsta ? 'bg-primary/10 text-primary' :
                            isDaangn ? 'bg-state-warn-soft text-state-warn' :
                            'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}>
                            {isNaver ? '네이버 블로그' : isInsta ? '인스타그램' : isDaangn ? '당근마켓' : '스레드'}
                          </span>

                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            cnt.state === 'waiting_for_approval' ? 'bg-state-warn-soft text-state-warn border border-state-warn/30 animate-pulse' :
                            cnt.state === 'scheduled' ? 'bg-state-wait-soft text-state-wait' :
                            cnt.state === 'completed' ? 'bg-state-ok-soft text-state-ok' :
                            'bg-zinc-100 text-zinc-600'
                          }`}>
                            {cnt.state === 'waiting_for_approval' ? '승인 대기' : cnt.state === 'scheduled' ? '예약됨' : cnt.state === 'completed' ? '발행 완료' : '계획 중'}
                          </span>
                        </div>

                        {/* Title & Applied Harness */}
                        <div>
                          <h3 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50 group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                            {cnt.title}
                          </h3>
                          {cnt.harnessName && (
                            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded mt-1.5 inline-block truncate max-w-full">
                              🌿 {cnt.harnessName}
                            </span>
                          )}
                        </div>

                        {/* Body Snippet */}
                        <p className="text-xs text-zinc-500 line-clamp-3 leading-relaxed">
                          {cnt.bodyContent}
                        </p>
                      </div>

                      {/* Footer Metrics */}
                      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-zinc-400">
                          <span>사전 품질 검사:</span>
                          <span className="font-mono font-bold text-state-ok">{cnt.qcScore} / 100점</span>
                        </div>
                        <div className="flex items-center justify-between text-zinc-400">
                          <span>예상 문의 목표:</span>
                          <span className="font-bold text-zinc-700 dark:text-zinc-300">{cnt.inquiryGoal}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1 font-bold">
                          <span className="text-zinc-500 font-mono text-[11px]">{cnt.scheduledDate}</span>
                          <span className="text-primary flex items-center gap-0.5 text-xs">
                            시안 검토 <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* 3. 📅 [마케팅 캘린더 타임테이블 (Monthly / Weekly / Daily)] */}
        {(viewMode === 'both' || viewMode === 'calendar') && (
          <div className="p-6 md:p-7 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-lg font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                <span>마케팅 캘린더 타임테이블 (월간 / 주간 / 일간)</span>
              </h2>
              <span className="text-xs text-zinc-500 font-mono">게시 예약 및 발행 확정 일정</span>
            </div>

            <MarketingCalendar
              isTestAccount={isTestAccount}
              onSelectEvent={(eventId) => {
                const found = contentList.find(c => c.id === eventId) || contentList[0]
                if (found) setSelectedContent(found)
              }}
            />
          </div>
        )}

        {/* 🌟 4. [하네스 심층 지식 열람 인스펙터 모달 (Harness Deep Inspector Modal)] */}
        {inspectingHarness && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
            <div className="relative w-full max-w-5xl max-h-[90vh] bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-900/60">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase bg-primary/10 text-primary border border-primary/30">
                      INSTAGRAM {inspectingHarness.version}
                    </span>
                    {/* 신뢰도 실측값이 없으므로 비율을 지어내지 않는다. 산출되면 그때 표시한다. */}
                    <span className="text-xs text-zinc-400 font-mono">신뢰도 측정 전</span>
                  </div>
                  <h2 className="text-xl md:text-2xl font-black text-white">
                    {inspectingHarness.title}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                    <span>Source: {inspectingHarness.sourceUrl}</span>
                    <a href={inspectingHarness.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-0.5">
                      <span>열기</span> <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSelectedHarnessId(inspectingHarness.id)
                      handleGenerateContent(inspectingHarness.id)
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>이 스타일로 즉시 미리보기</span>
                  </button>
                  <button
                    onClick={() => setInspectingHarness(null)}
                    className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer min-h-11 min-w-11 inline-flex items-center justify-center"
                    aria-label="닫기"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* 8대 탭 내비게이션 */}
              <div className="px-6 border-b border-zinc-800 flex items-center gap-1 overflow-x-auto bg-zinc-900/30 text-xs font-bold py-2">
                {[
                  { id: 'overview', label: '개요' },
                  { id: 'rules', label: '실행 규칙 (5대 모듈)' },
                  { id: 'evidence', label: '원천 근거 (Evidence)' },
                  { id: 'channels', label: '적용 채널' },
                  { id: 'performance', label: '성과 학습 (Performance)' },
                  { id: 'history', label: '버전 이력' },
                  { id: 'override', label: '+ 내 규칙 (Override)' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setInspectorTab(tab.id as any)}
                    className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap min-h-11 inline-flex items-center justify-center ${
                      inspectorTab === tab.id
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Inspector Content Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
                {/* 1. 개요 탭 */}
                {inspectorTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Scraped Lookbook Gallery */}
                    <div className="space-y-2">
                      <span className="font-extrabold text-sm text-zinc-200 flex items-center gap-1.5">
                        <Camera className="w-4 h-4 text-primary" />
                        <span>스크래핑된 대표 시술 룩북 갤러리 (4컷)</span>
                      </span>
                      <div className="grid grid-cols-4 gap-3">
                        {inspectingHarness.lookbookImages.map((img, i) => (
                          <div key={i} className="aspect-square rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900">
                            <img src={img} alt="룩북 상세" className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {/* 3대 핵심 운영 DNA */}
                      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
                        <div className="flex items-center gap-2 text-state-ok font-extrabold">
                          <Sparkles className="w-4 h-4" />
                          <span>3대 핵심 운영 DNA</span>
                        </div>
                        <div className="space-y-2">
                          {inspectingHarness.coreDna.map((dna, i) => (
                            <div key={i} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                              <span className="text-[11px] font-bold text-primary block mb-1">DNA #{i + 1}</span>
                              <p className="text-zinc-200 font-medium">{dna}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 추출된 4차원 톤앤매너 벡터 */}
                      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3.5">
                        <div className="flex items-center gap-2 text-primary font-extrabold">
                          <SlidersHorizontal className="w-4 h-4" />
                          <span>추출된 4차원 톤앤매너 벡터</span>
                        </div>

                        <div className="space-y-2.5 font-medium">
                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-400">전문성 (Professional)</span>
                              <span className="font-mono text-primary">{inspectingHarness.toneVector.professional}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${inspectingHarness.toneVector.professional}%` }} />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-400">공감도 (Empathy)</span>
                              <span className="font-mono text-state-ok">{inspectingHarness.toneVector.empathy}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-state-ok rounded-full" style={{ width: `${inspectingHarness.toneVector.empathy}%` }} />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-400">직관성 (Directness)</span>
                              <span className="font-mono text-state-warn">{inspectingHarness.toneVector.directness}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-state-warn rounded-full" style={{ width: `${inspectingHarness.toneVector.directness}%` }} />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-400">긴급성 (Urgency)</span>
                              <span className="font-mono text-primary">{inspectingHarness.toneVector.urgency}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${inspectingHarness.toneVector.urgency}%` }} />
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                          <div>문장 호흡: <span className="text-zinc-200 font-bold">{inspectingHarness.sentenceLengthProfile}</span></div>
                          <div>단락 분리: <span className="text-zinc-200 font-bold">{inspectingHarness.paragraphRhythm}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. 실행 규칙 탭 */}
                {inspectorTab === 'rules' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {inspectingHarness.rules.map((rule, idx) => (
                        <div key={idx} className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3 flex flex-col justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h3 className="font-extrabold text-sm text-zinc-100">{rule.title}</h3>
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/30">
                                {rule.type}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 font-medium leading-relaxed">
                              {rule.content}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                            <span className="text-zinc-500 font-medium truncate max-w-[70%]">근거: {rule.evidence}</span>
                            <span className="text-state-ok font-mono font-bold">{rule.confidence}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. 기타 탭 */}
                {inspectorTab !== 'overview' && inspectorTab !== 'rules' && (
                  <div className="p-12 text-center text-zinc-400 space-y-3 bg-zinc-900/40 rounded-2xl border border-zinc-800">
                    <Info className="w-8 h-8 text-primary mx-auto" />
                    <p className="font-bold text-sm text-zinc-200">
                      [{inspectorTab.toUpperCase()}] 세부 지식 원장 및 히스토리가 정식 연결되어 있습니다.
                    </p>
                    <p className="text-xs text-zinc-500">
                      사장님의 소희가 본 스타일 기준의 모든 원천 증거와 채널별 셋업을 완벽하게 기억하고 실행합니다.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Real-UI Channel Preview & Scheduling Modal */}
        {selectedContent && (
          <ContentDetailModal
            content={selectedContent}
            onClose={() => {
              setSelectedContent(null)
              loadWorkspaceContents()
            }}
            onPublishNow={handlePublishNow}
            onScheduleDate={handleScheduleDate}
            workspaceId={workspaceId}
          />
        )}
          </>
        )}
      </div>
    </V088AppShell>
  )
}
