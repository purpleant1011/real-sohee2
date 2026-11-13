'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CheckSquare,
  Sparkles,
  Send,
  CheckCircle2,
  Clock,
  Calendar,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  LayoutList,
  Layers2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  HomeApprovalItem,
  HomeApprovalsResponse,
  HomeApprovalsSummary,
} from '@/features/home/home-approval-types'
import { AudioMorningBrief } from './audio-morning-brief'
import { SwipeApprovalDeck } from './swipe-approval-deck'

export interface HomeApprovalHubProps {
  workspaceId: string
  businessName?: string
  density?: 'compact' | 'detailed'
  initialData?: HomeApprovalsResponse
  onActionComplete?: () => void
  onSummaryChange?: (summary: HomeApprovalsSummary) => void
}

type FilterTab = 'all' | 'post_publish' | 'dm_reply' | 'comment_reply'
type ViewMode = 'list' | 'swipe'

/** 접었을 때 보여 주는 승인 항목 수. 홈 한 화면 분량을 넘지 않게 잡는다. */
const COLLAPSED_ITEM_LIMIT = 3

export function HomeApprovalHub({
  workspaceId,
  businessName = '사장님',
  density = 'compact',
  initialData,
  onActionComplete,
  onSummaryChange,
}: HomeApprovalHubProps) {
  const router = useRouter()
  const [data, setData] = useState<HomeApprovalsResponse | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [expandedPreviewIds, setExpandedPreviewIds] = useState<Set<string>>(new Set())
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [isChangingAutonomy, setIsChangingAutonomy] = useState(false)
  // 홈이 지나치게 길어지지 않도록 목록은 기본 3건만 보여 주고 '더 보기'로 펼친다.
  // 정보는 삭제하지 않는다 — 펼치면 전체 항목이 그대로 나온다.
  const [showAllItems, setShowAllItems] = useState(false)

  const loadApprovals = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/home/approvals`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error('조회 실패')
      const json = await res.json()
      if (json.success && json.data) {
        setData(json.data)
        setError(false)
        if (json.data.summary && onSummaryChange) {
          onSummaryChange(json.data.summary)
        }
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!initialData) void loadApprovals()
  }, [loadApprovals, initialData])

  const togglePreview = (id: string) => {
    setExpandedPreviewIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApproveItem = async (item: HomeApprovalItem, createBooking = false) => {
    router.push(`/app/approvals?item=${encodeURIComponent(item.id)}`)
  }

  const handleDismissItem = async (item: HomeApprovalItem) => {
    setProcessingIds((prev) => new Set(prev).add(item.id))
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/home/approvals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss', itemIds: [item.id] }),
        }
      )
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || '처리 실패')

      toast.info('항목을 목록에서 제외했습니다.')

      setData((prev) => {
        if (!prev) return null
        const newItems = prev.items.filter((i) => i.id !== item.id)
        return {
          ...prev,
          items: newItems,
          summary: {
            ...prev.summary,
            total: Math.max(0, prev.summary.total - 1),
          },
        }
      })
      onActionComplete?.()
    } catch (err: any) {
      toast.error(err.message || '처리 중 오류가 발생했습니다.')
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const handleApproveAll = async () => {
    router.push('/app/approvals')
  }

  const handleChangeAutonomy = async (targetLevel: 'L1' | 'L2' | 'L3') => {
    setIsChangingAutonomy(true)
    try {
      const levelPayload =
        targetLevel === 'L1'
          ? 'L1_MANUAL'
          : targetLevel === 'L3'
          ? 'L3_AUTONOMOUS'
          : 'L2_ASSISTED'

      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/engagement/policy`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'all',
            autonomy_level: levelPayload,
          }),
        }
      )
      if (!res.ok) throw new Error('모드 변경 실패')

      toast.success(
        targetLevel === 'L1'
          ? 'L1 비서형 (전수 확인 모드)으로 전환되었습니다.'
          : targetLevel === 'L3'
          ? 'L3 점장형 (풀 에이전트 자율 모드)으로 전환되었습니다.'
          : 'L2 안심 자율 모드로 전환되었습니다.'
      )
      await loadApprovals()
    } catch (err: any) {
      toast.error(err.message || '자율운영 모드 변경 중 오류가 발생했습니다.')
    } finally {
      setIsChangingAutonomy(false)
    }
  }

  const filteredItems = useMemo(() => {
    if (!data) return []
    if (activeFilter === 'all') return data.items
    return data.items.filter((i) => i.category === activeFilter)
  }, [data, activeFilter])

  const handleFilterChange = useCallback((next: FilterTab) => {
    setActiveFilter(next)
    setShowAllItems(false)
  }, [])

  const visibleItems = useMemo(
    () => (showAllItems ? filteredItems : filteredItems.slice(0, COLLAPSED_ITEM_LIMIT)),
    [filteredItems, showAllItems],
  )
  const hiddenItemCount = filteredItems.length - visibleItems.length

  if (loading) {
    return (
      <section aria-label="승인 센터 로딩" className="space-y-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
      </section>
    )
  }

  if (error || !data) {
    return null
  }

  const { items, autonomyLevel, autoHandledLabel, autoHandledCount, summary } = data

  const getCategoryBadge = (category: HomeApprovalItem['category']) => {
    switch (category) {
      case 'comment_reply':
        return (
          <Badge variant="outline" className="text-[11px] font-semibold bg-muted text-foreground border-border">
            댓글 답글
          </Badge>
        )
      case 'post_publish':
        return (
          <Badge variant="outline" className="text-[11px] font-semibold bg-muted text-foreground border-border">
            포스팅 발행
          </Badge>
        )
      case 'dm_reply':
        return (
          <Badge variant="outline" className="text-[11px] font-semibold bg-muted text-foreground border-border">
            DM 문의 답변
          </Badge>
        )
      case 'proposal':
        return (
          <Badge variant="outline" className="text-[11px] font-semibold bg-muted text-foreground border-border">
            소희 제안
          </Badge>
        )
    }
  }

  return (
    <section id="approval-hub" aria-label="소희 빠른 승인 센터" className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs transition-all">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 text-primary">
              <CheckSquare className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">
                  소희 빠른 승인 센터
                </h2>
                {items.length > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-bold bg-primary/10 text-primary">
                    {items.length}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                사장님의 손길이 필요한 작업을 홈에서 바로 승인해요.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
            {/* 1. Audio Morning Brief Button */}
            <AudioMorningBrief
              businessName={businessName}
              items={items}
              autonomyLevel={autonomyLevel}
              autoHandledCount={autoHandledCount}
            />

            {/* Quick Autonomy Selector */}
            <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => handleChangeAutonomy('L1')}
                disabled={isChangingAutonomy}
                className={`px-2 py-1 rounded-md transition-colors ${
                  autonomyLevel === 'L1'
                    ? 'bg-background text-foreground font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                L1 비서
              </button>
              <button
                type="button"
                onClick={() => handleChangeAutonomy('L2')}
                disabled={isChangingAutonomy}
                className={`px-2 py-1 rounded-md transition-colors ${
                  autonomyLevel === 'L2'
                    ? 'bg-background text-state-ok font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                L2 안심자율
              </button>
              <button
                type="button"
                onClick={() => handleChangeAutonomy('L3')}
                disabled={isChangingAutonomy}
                className={`px-2 py-1 rounded-md transition-colors ${
                  autonomyLevel === 'L3'
                    ? 'bg-background text-primary font-semibold shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                L3 점장
              </button>
            </div>

            {items.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleApproveAll}
                disabled={isApprovingAll}
                className="h-7 text-xs font-medium text-primary border-primary/30 hover:bg-primary/10"
              >
                {isApprovingAll ? '처리 중...' : `확인할 작업 보기 (${items.length})`}
              </Button>
            )}
          </div>
        </div>

        {/* L2/L3 Auto-handled Banner */}
        {autoHandledCount > 0 && autoHandledLabel && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-state-ok-soft border border-[var(--state-ok-line)] text-xs text-state-ok mb-3">
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-state-ok" />
            <span className="font-medium">{autoHandledLabel}</span>
          </div>
        )}

        {/* 🌟 지식 부족 시 상시 안내 배너: 알맹이 없는 제안 차단 및 지식 입력 유도 */}
        {data?.knowledgeStatus?.needsKnowledgePrompt && (
          <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
            <div className="flex items-start gap-2.5">
              <Sparkles className="size-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-bold text-foreground">
                  소희가 우리 매장을 더 잘 배울 수 있도록 지식을 알려주세요!
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  아직 대표 메뉴나 서비스 특징이 부족해요. 지식을 알려주시면 우리 가게에 딱 맞는 고품질 맞춤 콘텐츠를 먼저 제안해 드려요.
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-8 px-3 shrink-0 self-start sm:self-auto shadow-xs">
              <Link href="/app/sohee">
                지식 가르치기 ➔
              </Link>
            </Button>
          </div>
        )}

        {/* Category Filter Pills & View Mode Switch */}
        {items.length > 0 && (
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-border/40 overflow-x-auto text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => handleFilterChange('all')}
                className={`px-2.5 py-1 rounded-full border transition-all ${
                  activeFilter === 'all'
                    ? 'bg-foreground text-background font-medium border-foreground'
                    : 'bg-background text-muted-foreground border-border hover:border-foreground/40'
                }`}
              >
                전체 ({items.length})
              </button>
              {summary.posts > 0 && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('post_publish')}
                  className={`px-2.5 py-1 rounded-full border transition-all ${
                    activeFilter === 'post_publish'
                      ? 'bg-foreground text-background font-medium border-foreground'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/40'
                  }`}
                >
                  포스팅 ({summary.posts})
                </button>
              )}
              {summary.dms > 0 && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('dm_reply')}
                  className={`px-2.5 py-1 rounded-full border transition-all ${
                    activeFilter === 'dm_reply'
                      ? 'bg-foreground text-background font-medium border-foreground'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/40'
                  }`}
                >
                  DM·예약 ({summary.dms})
                </button>
              )}
              {summary.comments > 0 && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('comment_reply')}
                  className={`px-2.5 py-1 rounded-full border transition-all ${
                    activeFilter === 'comment_reply'
                      ? 'bg-foreground text-background font-medium border-foreground'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/40'
                  }`}
                >
                  댓글 ({summary.comments})
                </button>
              )}
            </div>

            {/* 2. View Mode Switch: List vs Swipe */}
            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/50 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="리스트 뷰"
                className={`p-1 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('swipe')}
                title="스와이프 덱 뷰"
                className={`p-1 rounded transition-colors ${
                  viewMode === 'swipe'
                    ? 'bg-background text-primary shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* View Routing: Swipe Deck vs Standard List */}
        {viewMode === 'swipe' && filteredItems.length > 0 ? (
          <SwipeApprovalDeck
            items={filteredItems}
            onApprove={handleApproveItem}
            onDismiss={handleDismissItem}
            onComplete={() => setViewMode('list')}
          />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-1.5">
            <div className="w-10 h-10 rounded-full bg-state-ok-soft text-state-ok flex items-center justify-center mb-1">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-foreground">
              지금 확인할 항목이 모두 끝났어요! 🎉
            </p>
            <p className="text-xs text-muted-foreground">
              새로운 고객 문의나 포스팅 초안이 준비되면 소희가 바로 알려드릴게요.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            선택한 카테고리에 대기 중인 항목이 없습니다.
          </div>
        ) : (
          <div id="home-approval-items" className="space-y-2.5">
            {visibleItems.map((item) => {
              const isProcessing = processingIds.has(item.id)
              const isPreviewOpen = density === 'detailed' || expandedPreviewIds.has(item.id)

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/80 bg-background/80 hover:bg-background p-3.5 space-y-2.5 transition-colors"
                >
                  {/* Item Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getCategoryBadge(item.category)}
                      <span className="text-xs font-bold text-foreground">
                        {item.targetLabel}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.goldenTimeLabel && (
                        <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                          {item.goldenTimeLabel}
                        </span>
                      )}
                      {item.urgency && (
                        <span className="text-[11px] font-medium text-state-warn flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.urgency}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3. ROI Impact Predictor Badge */}
                  {item.roiImpact && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-semibold">{item.roiImpact.label}:</span>
                      <span>{item.roiImpact.value}</span>
                    </div>
                  )}

                  {/* Snippets */}
                  <div className="space-y-1 text-xs">
                    {item.sourceSnippet && (
                      <p className="text-muted-foreground line-clamp-2">
                        <span className="font-medium text-foreground/80">원문:</span> {item.sourceSnippet}
                      </p>
                    )}
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 text-foreground font-normal leading-relaxed">
                      <span className="font-semibold text-primary mr-1.5">
                        소희 추천:
                      </span>
                      {item.draftSnippet}
                    </div>
                  </div>

                  {/* Expandable Preview Drawer */}
                  {isPreviewOpen && (
                    <div className="p-3 rounded-lg bg-muted/30 border border-primary/20 space-y-2 text-xs">
                      <div className="flex items-center justify-between font-semibold text-primary">
                        <span className="flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5" />
                          실제 게시 미리보기
                        </span>
                        <span className="text-[11px] text-muted-foreground font-normal">
                          Instagram · Threads 피드 규격
                        </span>
                      </div>
                      {item.imageUrl ? (
                        <div className="relative w-full max-w-sm aspect-[4/5] sm:aspect-video rounded-xl overflow-hidden bg-muted border border-border shadow-xs my-2">
                          <img
                            src={item.imageUrl}
                            alt="포스팅 미리보기"
                            loading="lazy"
                            decoding="async"
                            sizes="(max-width: 640px) 100vw, 384px"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : item.category === 'post_publish' || item.category === 'proposal' ? (
                        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-center space-y-2 my-2">
                          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-primary">
                            <Sparkles className="size-4 animate-pulse" />
                            <span>소희 AI 맞춤 사진과 함께 발행돼요</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            발행 시 소희가 본문 주제와 매장 분위기에 어울리는 고화질 사진을 함께 게시합니다.
                          </p>
                        </div>
                      ) : null}
                      <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                        {item.fullCaption || item.draftSnippet}
                      </p>
                      {item.hashtags && item.hashtags.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1 text-primary font-medium">
                          {item.hashtags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions Bar (모바일 390px 찌그러짐 방지 & 터치 타깃 44px 이상) */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-border/40">
                    <div className="min-w-fit shrink-0">
                      {item.fullCaption && density !== 'detailed' && (
                        <button
                          type="button"
                          onClick={() => togglePreview(item.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors whitespace-nowrap min-h-[36px] py-1 px-1.5"
                        >
                          {isPreviewOpen ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">미리보기 닫기</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">상세 미리보기</span>
                            </>
                          )}
                        </button>
                      )}
                      {density === 'detailed' && (
                        <span className="text-[11px] text-muted-foreground/80 font-medium">
                          상세 검토 모드 활성화됨
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismissItem(item)}
                        disabled={isProcessing}
                        className="min-h-[38px] px-3 text-xs text-muted-foreground hover:text-foreground cursor-pointer whitespace-nowrap shrink-0"
                      >
                        제외
                      </Button>

                      {/* Combo Action for DM with Suggested Booking */}
                      {item.category === 'dm_reply' && item.suggestedBooking ? (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleApproveItem(item, true)}
                          disabled={isProcessing}
                          className="min-h-[40px] px-3.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Calendar className="w-3.5 h-3.5 mr-1 shrink-0" />
                          <span>{isProcessing ? '처리 중...' : '전체 내용 검토하기'}</span>
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleApproveItem(item, false)}
                          disabled={isProcessing}
                          className="min-h-[40px] px-3.5 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Send className="w-3.5 h-3.5 mr-1 shrink-0" />
                          <span>{isProcessing ? '처리 중...' : '전체 내용 검토하기'}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {(hiddenItemCount > 0 || showAllItems) && filteredItems.length > COLLAPSED_ITEM_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAllItems((prev) => !prev)}
                aria-expanded={showAllItems}
                aria-controls="home-approval-items"
                className="flex w-full min-h-11 items-center justify-center gap-1 rounded-xl border border-border/80 bg-background/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {showAllItems ? (
                  <>
                    <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                    승인 목록 접기
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                    나머지 {hiddenItemCount}건 더 보기
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
