'use client'

import React, { useState } from 'react'
import { 
  Target, 
  FlaskConical, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  Play, 
  Pause, 
  Sparkles,
  ChevronRight,
  BarChart2
} from 'lucide-react'
import { AgentStateBadge } from '@/components/v088/agent-state-badge'

interface CampaignExperimentViewProps {
  isTestAccount?: boolean
}

export function CampaignExperimentView({ isTestAccount = false }: CampaignExperimentViewProps) {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'experiments'>('campaigns')

  const campaigns = isTestAccount ? [
    {
      id: 'camp-1',
      title: '2026 봄맞이 신규 유입 & 첫 방문 15% 할인 캠페인',
      objective: '주중 유휴 슬롯 6개 소진 및 신규 고객 8명 확보',
      status: 'running' as const,
      budgetWon: 50000,
      spentWon: 0,
      targetRevenueWon: 1000000,
      realizedRevenueWon: 540000,
      channels: ['네이버 블로그', '인스타그램', '당근마켓'],
      missionsCount: 3,
      completedMissionsCount: 2
    },
    {
      id: 'camp-2',
      title: '단골 고객 60일 재방문 주기 리텐션 캠페인',
      objective: '방문 후 60일 경과 단골 고객 재방문율 60% 달성',
      status: 'scheduled' as const,
      budgetWon: 0,
      spentWon: 0,
      targetRevenueWon: 600000,
      realizedRevenueWon: 0,
      channels: ['카카오 알림톡', '인스타그램 DM'],
      missionsCount: 2,
      completedMissionsCount: 0
    }
  ] : []

  const experiments = isTestAccount ? [
    {
      id: 'exp-1',
      title: '인스타그램 피드 훅(Hook): [비포애프터 감성] vs [서비스 팁 텍스트]',
      hypothesis: '자연스러운 전후 비교 감성 훅이 단순 정보 나열형보다 예약 문의율이 30% 높을 것이다.',
      variable: 'Hook',
      status: 'concluded' as const,
      variantA: { name: 'A (정보 나열)', clicks: 25, inquiries: 2, cvr: '8.0%' },
      variantB: { name: 'B (감성 전후비교)', clicks: 32, inquiries: 8, cvr: '25.0%' },
      winner: 'B (감성 전후비교)',
      learning: '감성 전후비교 훅이 3배 이상의 전환율을 달성하여 플레이북 기본 템플릿으로 등록됨.'
    }
  ] : []

  return (
    <div className="space-y-6">
      {/* Campaign & Experiment Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center p-1 rounded-xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-xs font-bold">
          <button
            onClick={() => setActiveTab('campaigns')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'campaigns' ? 'bg-primary text-white shadow-sm' : 'text-[var(--v088-muted)]'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>전략 캠페인 ({campaigns.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('experiments')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'experiments' ? 'bg-primary text-white shadow-sm' : 'text-[var(--v088-muted)]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>A/B 실험실 ({experiments.length})</span>
          </button>
        </div>
      </div>

      {/* Campaigns List */}
      {activeTab === 'campaigns' && (
        campaigns.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-center space-y-2">
            <Target className="w-8 h-8 text-zinc-400 mx-auto" />
            <h3 className="font-bold text-sm text-[var(--v088-ink)]">진행 중인 전략 캠페인이 없습니다</h3>
            <p className="text-xs text-[var(--v088-muted)]">소희와 대화하여 우리 매장의 특정 시즌, 유휴 슬롯 방어 또는 신규 고객 유치 캠페인을 시작해 보세요.</p>
          </div>
        ) : (
        <div className="space-y-4">
          {campaigns.map((camp) => (
            <div
              key={camp.id}
              className="p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-primary uppercase">
                      마케팅 캠페인
                    </span>
                    <AgentStateBadge state={camp.status} size="sm" />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--v088-ink)]">{camp.title}</h3>
                  <p className="text-xs text-[var(--v088-muted)] mt-0.5">목표: {camp.objective}</p>
                </div>

                <div className="flex items-center gap-2">
                  {camp.channels.map((ch) => (
                    <span key={ch} className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--v088-surface-subtle)] border border-[var(--v088-border-subtle)] font-medium text-[var(--v088-ink)]">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              {/* Progress bar and Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[var(--v088-border)] text-xs">
                <div>
                  <span className="text-[var(--v088-muted)] block mb-1">미션 진행률</span>
                  <div className="font-bold text-sm text-[var(--v088-ink)]">
                    {camp.completedMissionsCount} / {camp.missionsCount} 완료
                  </div>
                </div>
                <div>
                  <span className="text-[var(--v088-muted)] block mb-1">확정 매출 달성도</span>
                  <div className="font-bold text-sm text-primary font-mono">
                    {camp.realizedRevenueWon.toLocaleString()}원 / {camp.targetRevenueWon.toLocaleString()}원 ({Math.round((camp.realizedRevenueWon / camp.targetRevenueWon) * 100)}%)
                  </div>
                </div>
                <div>
                  <span className="text-[var(--v088-muted)] block mb-1">집행 예산</span>
                  <div className="font-bold text-sm text-state-ok font-mono">
                    {camp.spentWon.toLocaleString()}원 (예산 {camp.budgetWon.toLocaleString()}원)
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        )
      )}

      {/* Experiments List */}
      {activeTab === 'experiments' && (
        experiments.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-center space-y-2">
            <FlaskConical className="w-8 h-8 text-zinc-400 mx-auto" />
            <h3 className="font-bold text-sm text-[var(--v088-ink)]">진행 중인 A/B 실험이 없습니다</h3>
            <p className="text-xs text-[var(--v088-muted)]">소희가 제작한 카피와 훅(Hook)의 A/B 테스트 성과가 누적되면 승자 분석 결과가 이곳에 표시됩니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {experiments.map((exp) => (
              <div
                key={exp.id}
                className="p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-state-ok uppercase block mb-1">
                      통계적 검증 완료 (Concluded)
                    </span>
                    <h3 className="text-base font-bold text-[var(--v088-ink)]">{exp.title}</h3>
                    <p className="text-xs text-[var(--v088-muted)] mt-0.5">가설: {exp.hypothesis}</p>
                  </div>
                  <span className="text-xs px-3 py-1 rounded-xl bg-state-ok-soft text-state-ok font-bold border border-state-ok/30">
                    승자: {exp.winner}
                  </span>
                </div>

                {/* Variants comparison table */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="p-3.5 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border-subtle)]">
                    <span className="font-bold text-[var(--v088-ink)] block mb-1">{exp.variantA.name}</span>
                    <div className="text-[var(--v088-muted)]">클릭: {exp.variantA.clicks}회 · 문의: {exp.variantA.inquiries}건 · 전환율: <span className="font-semibold text-[var(--v088-ink)]">{exp.variantA.cvr}</span></div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/40">
                    <span className="font-bold text-foreground dark:text-primary block mb-1">🏆 {exp.variantB.name} (승자)</span>
                    <div className="text-foreground dark:text-primary">클릭: {exp.variantB.clicks}회 · 문의: {exp.variantB.inquiries}건 · 전환율: <span className="font-bold text-state-ok">{exp.variantB.cvr}</span></div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-state-ok/60 text-xs text-state-ok flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-state-ok flex-shrink-0" />
                  <span>{exp.learning}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
