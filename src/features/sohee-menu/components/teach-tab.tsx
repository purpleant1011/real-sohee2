'use client'

import React from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InterviewEngine } from '@/features/sohee-menu/components/interview-engine'
import { MaterialsBox } from '@/features/sohee-menu/components/materials-box'
import { KnownBusinessCard } from '@/features/sohee-menu/components/known-business-card'
import { KnowledgeSimulator } from '@/features/sohee-menu/components/knowledge-simulator'
import { KnowledgeLibrary } from '@/features/sohee-menu/components/knowledge-library'
import { NaverPlaceConnectCard } from '@/features/knowledge/naver-place/naver-place-connect-card'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'
import type { GrowthSnapshot } from '@/features/sohee-growth/types'
import type { useWorkspaceProfileForm } from '@/features/sohee-menu/use-workspace-profile-form'

interface TeachTabProps {
  snapshot: GrowthSnapshot | null
  form: ReturnType<typeof useWorkspaceProfileForm>
  workspaceId: string
  onRefresh: () => void
}

export function TeachTab({ snapshot, form, workspaceId, onRefresh }: TeachTabProps) {
  return (
    <div className="space-y-6">
      {/* 1. 상단: KnownBusinessCard (매장 이해도 % 및 6대 카테고리 현황) */}
      {snapshot ? (
        <KnownBusinessCard categories={snapshot.categories} nextStep={snapshot.nextStep} />
      ) : (
        <Skeleton className="h-48 w-full rounded-[20px]" />
      )}

      {/* 2. 매장 기본 정보 직접 등록 안내 카드 */}
      <NaverPlaceConnectCard
        workspaceId={workspaceId}
        onPlaceSynced={(summary) => {
          if (summary.name) form.setField('businessName', summary.name)
          if (summary.category) form.setField('industry', summary.category)
          if (summary.roadAddress) form.setField('location', summary.roadAddress)
          onRefresh()
        }}
      />

      {/* 2-1. 매장 공식 채널 지식 학습 (URL 등록 -> 소유권 확인 -> 지식 학습/검토) */}
      <section aria-label="매장 공식 채널 지식 학습" className="space-y-3">
        <ChannelLearningPanel
          workspaceId={workspaceId}
          canManage={true}
          onKnowledgeUpdated={onRefresh}
        />
      </section>

      {/* 3. 중앙 메인: 2열 고밀도 관제센터 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 좌측 메인 컬럼 (지식 생산 & 관리: 인터뷰 엔진 + 지식 도서관) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-6">
          {/* 소희의 스마트 이어하기 인터뷰 */}
          <InterviewEngine workspaceId={workspaceId} onFactConfirmed={onRefresh} />

          {/* 내가 가르친 지식 도서관 (5대 카테고리 덱·활용처 배지·인라인 편집/추가) */}
          <KnowledgeLibrary workspaceId={workspaceId} onKnowledgeChanged={onRefresh} />
        </div>

        {/* 우측 서브 컬럼 (지식 검증 & 자료 보관: 시뮬레이터 + 멀티 포맷 자료함) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          {/* 소희 지식 모의 테스트 벤치 (시뮬레이터) */}
          <KnowledgeSimulator workspaceId={workspaceId} />

          {/* 멀티 포맷 자료함 (PDF·문서·이미지·URL 등록) */}
          <MaterialsBox workspaceId={workspaceId} onMaterialUpdated={onRefresh} />
        </div>
      </div>

      {/* 4. 하단: 우리 가게 기본 정보 폼 */}
      <Card className="space-y-4 rounded-[20px] p-6">
        <h2 className="text-lg font-bold">우리 가게 정보</h2>

        {form.status.proposalAlert && (
          <div
            role="status"
            className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs font-semibold text-primary"
          >
            {form.status.proposalAlert}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void form.save()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="business-name" className="text-xs font-bold">
              가게 이름
            </Label>
            <Input
              id="business-name"
              type="text"
              value={form.values.businessName}
              onChange={(e) => form.setField('businessName', e.target.value)}
              placeholder="예: 바른고기 청라점"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry" className="text-xs font-bold">
              업종과 주력 상품·서비스
            </Label>
            <Input
              id="industry"
              type="text"
              value={form.values.industry}
              onChange={(e) => form.setField('industry', e.target.value)}
              placeholder="예: 숙성 한우 전문점"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location" className="text-xs font-bold">
              위치와 상권
            </Label>
            <Input
              id="location"
              type="text"
              value={form.values.location}
              onChange={(e) => form.setField('location', e.target.value)}
              placeholder="예: 인천 서구 청라커낼로"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary" className="text-xs font-bold">
              가게 소개와 강점
            </Label>
            <Textarea
              id="summary"
              rows={3}
              value={form.values.summary}
              onChange={(e) => form.setField('summary', e.target.value)}
              placeholder="예: 웻에이징 30일 숙성 한우와 정갈한 상차림을 제공합니다."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="keywords" className="text-xs font-bold">
              핵심 키워드(쉼표로 구분)
            </Label>
            <Input
              id="keywords"
              type="text"
              value={form.values.keywords}
              onChange={(e) => form.setField('keywords', e.target.value)}
              placeholder="예: 청라맛집, 숙성한우, 가족모임"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-end sm:items-center justify-between gap-2 pt-2">
            <div className="text-xs font-semibold">
              {form.status.saveSuccess && (
                <span className="text-state-ok">저장했어요</span>
              )}
              {form.status.saveError && (
                <span className="text-destructive font-bold">{form.status.saveError}</span>
              )}
            </div>
            <Button type="submit" disabled={form.status.isSaving}>
              {form.status.isSaving ? '저장 중...' : '저장하기'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
