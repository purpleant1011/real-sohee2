'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronDown, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { STAGE_LABEL, stageOf } from '@/components/quick-post/types'
import { TodayCardView, VaultSummaryLine } from '@/features/home/today-card'
import { ComingSoonRoadmap, EmptyState, FirstWeekPlan } from '@/features/empty-states/empty-state'
import { HomeApprovalHub } from './home-approval-hub'
import { MagicPhotoDropzone } from './magic-photo-dropzone'
import { WeeklyTruthSummary } from '@/features/reporting/weekly-truth-summary'
import type { HomeDisplayDensity } from './home-display-density'
import type { LegacyHomeData } from './use-legacy-home-data'

const AdvancedHome = dynamic(() => import('./advanced-home').then((module) => module.AdvancedHome), {
  loading: () => (
    <p role="status" className="text-sm text-muted-foreground">
      자세한 업무 현황을 준비하고 있어요.
    </p>
  ),
})

export interface TodayHeroSectionProps {
  data: LegacyHomeData
  density: HomeDisplayDensity
}

export function TodayHeroSection({ data, density }: TodayHeroSectionProps) {
  const { model, posts, isInitialLoading, refresh, todayCardData, approvalsSummary } = data

  return (
    <section aria-label="오늘 할 일" className="space-y-3">
      {isInitialLoading && (
        <div role="status" className="space-y-3">
          <p className="text-sm text-muted-foreground">오늘 할 일을 불러오고 있어요.</p>
          <Skeleton className="h-44 rounded-2xl w-full" />
        </div>
      )}

      {!isInitialLoading && (
        <>
          {(model.error || posts.error) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm text-foreground"
            >
              <span>오늘의 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</span>
              <Button variant="outline" size="sm" onClick={refresh}>
                다시 불러오기
              </Button>
            </div>
          )}

          <div className="relative rounded-2xl ring-1 ring-primary/25 shadow-xs transition-all hover:ring-primary/40">
            <TodayCardView
              card={todayCardData}
              pendingSummary={approvalsSummary}
              density={density}
            />
          </div>
        </>
      )}
    </section>
  )
}

export interface LegacyHomeSectionsProps {
  workspaceId: string
  data: LegacyHomeData
  density: HomeDisplayDensity
  includeTodayHero?: boolean
  includeWeeklyTruthSummary?: boolean
  includeMagicPhotoDropzone?: boolean
}

export function LegacyHomeSections({
  workspaceId,
  data,
  density,
  includeTodayHero = true,
  includeWeeklyTruthSummary = true,
  includeMagicPhotoDropzone = true,
}: LegacyHomeSectionsProps) {
  const {
    model,
    posts,
    vaultSummary,
    vaultSummaryLineData,
    businessName,
    recent,
    refresh,
    refreshCount,
    setApprovalsSummary,
  } = data

  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 1. 홈 최상단 오늘 할 일 1개 영웅 카드 */}
      {includeTodayHero && <TodayHeroSection data={data} density={density} />}

      {/* 2. 3개 메트릭 카드 ("소희가 하는 일 · 게시 확인 · 확인된 예약") */}
      {includeWeeklyTruthSummary && (
        <section aria-label="업무 현황 요약">
          <WeeklyTruthSummary workspaceId={workspaceId} key={refreshCount} collapsible />
        </section>
      )}

      {/* 3. 소희 빠른 승인 센터 */}
      <HomeApprovalHub
        workspaceId={workspaceId}
        businessName={businessName}
        density={density}
        onActionComplete={refresh}
        onSummaryChange={setApprovalsSummary}
      />

      {/* 4. 사진 도구: 사진 한 장으로, 다음 콘텐츠 준비 */}
      {includeMagicPhotoDropzone && (
        <MagicPhotoDropzone workspaceId={workspaceId} density={density} />
      )}

      {/* 6. 보관함 요약 한 줄 (상세 모드) */}
      {density === 'detailed' && (
        <section aria-label="보관함 현황">
          {vaultSummary.loading ? (
            <Skeleton className="h-12 rounded-xl w-full" />
          ) : (
            <VaultSummaryLine data={vaultSummaryLineData} />
          )}
        </section>
      )}

      {/* 8. 최근 게시물 (상세 모드) */}
      {density === 'detailed' && (
        <section aria-label="최근 게시물" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground">최근 게시물</h2>
            <Button asChild variant="link" className="text-xs sm:text-sm">
              <Link href="/app/content">모든 게시물 보기</Link>
            </Button>
          </div>

          {posts.loading ? (
            <div role="status" className="space-y-2">
              <p className="text-sm text-muted-foreground">최근 게시물을 불러오고 있어요.</p>
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : posts.error ? (
            <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              최근 게시물을 확인할 수 없어요.
            </p>
          ) : recent.length === 0 ? (
            <EmptyState area="home" />
          ) : (
            <div className="grid gap-3">
              {recent.map((post) => (
                <Link
                  key={post.missionId}
                  href={`/app/content?post=${encodeURIComponent(post.missionId)}`}
                  className="flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-lg">
                    <AvatarImage src={post.imageUrl ?? undefined} alt="" className="object-cover" />
                    <AvatarFallback className="rounded-lg bg-muted">
                      <ImageIcon aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground text-sm sm:text-base">
                      {post.topic?.trim() || '제목 없는 게시물'}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      게시물 자세히 보기
                    </span>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {stageOf(post.status) === 'published' ? '게시 결과 상세 확인' : STAGE_LABEL[stageOf(post.status)]}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {!model.loading && !posts.loading && !model.error && !posts.error && posts.value?.length === 0 && (
        <FirstWeekPlan />
      )}
      <ComingSoonRoadmap />

      {/* 9. 자세히 보기(고급) */}
      <section className="border-t border-border pt-6">
        <Button
          variant="outline"
          aria-expanded={advancedOpen}
          aria-controls="home-advanced-content"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="w-full justify-between text-left cursor-pointer"
        >
          <span>{advancedOpen ? '자세히 보기(고급) 접기' : '자세히 보기(고급)'}</span>
          <ChevronDown
            aria-hidden="true"
            className={`transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`}
          />
        </Button>
        {advancedOpen && (
          <div id="home-advanced-content" className="mt-6">
            <h2 className="mb-4 text-xl font-semibold">자세한 업무 현황</h2>
            <AdvancedHome workspaceId={workspaceId} readModel={model.value} />
          </div>
        )}
      </section>
    </div>
  )
}
