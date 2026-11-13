'use client'

import React, { useState } from 'react'
import { 
  Sparkles, 
  Check, 
  X, 
  AlertTriangle, 
  Calendar, 
  Clock, 
  Users, 
  ShieldAlert, 
  Power, 
  ArrowRight,
  Send,
  CheckCircle2,
  Share2
} from 'lucide-react'
import { AgentStateBadge, type AgentLifecycleState } from '@/components/v088/agent-state-badge'

export interface MobileCompanionProps {
  activeMobileTab?: 'today' | 'decision' | 'customers' | 'missions' | 'more'
  onTabChange?: (tab: 'today' | 'decision' | 'customers' | 'missions' | 'more') => void
}

export function MobileCompanion({
  activeMobileTab = 'today',
  onTabChange
}: MobileCompanionProps) {
  const [killSwitch, setKillSwitch] = useState(false)
  const [decisions, setDecisions] = useState([
    {
      id: 'm-dec-1',
      title: '네이버 블로그 [봄맞이 인기 메뉴 안내] 발행 승인',
      channel: '네이버 블로그',
      riskTier: 'R2',
      expiresIn: '오늘 14:00 (1시간 남음)',
      whyNow: '주중 검색 트래픽 선점 위해 오후 2시 전 발행 필수',
      expectedEffect: '예약 문의 4~6건 증대',
      preview: '2026 봄맞이 우리 매장 대표 시그니처 소개 칼럼...'
    },
    {
      id: 'm-dec-2',
      title: '화/수 유휴 슬롯 15% 할인 프로모션 오퍼',
      channel: '당근마켓',
      riskTier: 'R2',
      expiresIn: '내일 10:00',
      whyNow: '화/수 오후 유휴 슬롯 4개 예약 전환율 향상',
      expectedEffect: '전환율 22% → 48% 상승',
      preview: '첫 방문 고객 대상 평일 15% 할인 혜택...'
    }
  ])

  const handleApprove = (id: string) => {
    setDecisions(prev => prev.filter(d => d.id !== id))
  }

  const handleReject = (id: string) => {
    setDecisions(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="md:hidden space-y-4 pb-20">
      {/* 1. Mobile Today View (ANI-208) */}
      {activeMobileTab === 'today' && (
        <div className="space-y-4">
          {/* Morning Brief Card */}
          <div className="p-5 rounded-2xl bg-primary text-primary-foreground shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-primary-foreground uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                소희의 모닝 브리핑
              </span>
              <span className="text-[10px] text-primary-foreground/80 font-mono">09:00</span>
            </div>
            <h3 className="font-bold text-base leading-snug">
              화·수 유휴 슬롯 6개를 채우기 위한 15% 프로모션을 가동 중입니다.
            </h3>
            <p className="text-xs text-primary-foreground/90 leading-relaxed">
              네이버 블로그 초안 생성이 완료되어 승인 대기 중이며, 승인 즉시 자동 발행됩니다.
            </p>
          </div>

          {/* Focus Mission Snapshot */}
          <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--v088-ink)]">집중 미션</span>
              <AgentStateBadge state="running" size="sm" />
            </div>
            <h4 className="font-bold text-sm text-[var(--v088-ink)]">
              봄맞이 신규 고객 유치 및 첫 방문 프로모션
            </h4>
            <div className="flex items-center gap-1.5 text-xs text-state-ok font-semibold">
              <Clock className="w-3.5 h-3.5" />
              <span>04 품질 게이트 검증 완료 (96점)</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Mobile Decision 20-sec Card View (ANI-209) */}
      {activeMobileTab === 'decision' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-[var(--v088-ink)]">
              사장님 결정 큐 ({decisions.length})
            </h3>
            <span className="text-xs text-primary font-semibold">20초 원클릭 승인</span>
          </div>

          {decisions.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-xs text-[var(--v088-muted)]">
              🎉 모든 의사결정이 완료되었습니다!
            </div>
          ) : (
            decisions.map((dec) => (
              <div
                key={dec.id}
                className="p-5 rounded-2xl bg-[var(--v088-surface)] border border-primary/30 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-primary">{dec.channel}</span>
                  <span className="text-state-danger font-bold font-mono text-[11px]">{dec.expiresIn}</span>
                </div>

                <h4 className="font-bold text-sm text-[var(--v088-ink)] leading-snug">
                  {dec.title}
                </h4>

                <div className="p-3 rounded-xl bg-[var(--v088-surface-subtle)] text-xs text-[var(--v088-ink)] space-y-1">
                  <div><span className="text-[var(--v088-muted)]">이유: </span>{dec.whyNow}</div>
                  <div><span className="text-[var(--v088-muted)]">효과: </span><span className="font-semibold text-state-ok">{dec.expectedEffect}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => handleReject(dec.id)}
                    className="py-2.5 rounded-xl border border-[var(--v088-border)] text-xs font-bold text-[var(--v088-muted)] hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>반려</span>
                  </button>
                  <button
                    onClick={() => handleApprove(dec.id)}
                    className="py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md shadow-primary/20 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>즉시 승인</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 3. Mobile Customers View (ANI-210) */}
      {activeMobileTab === 'customers' && (
        <div className="space-y-3">
          <h3 className="font-bold text-base text-[var(--v088-ink)]">긴급 고객 문의</h3>
          <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">김민지 (@minji_kim)</span>
              <span className="text-[10px] font-mono text-[var(--v088-muted)]">12분 전</span>
            </div>
            <p className="text-xs text-[var(--v088-ink)]">
              &quot;첫 방문인데 화요일 오후 3시에 상담 및 서비스 예약 가능할까요?&quot;
            </p>
            <div className="p-2.5 rounded-xl bg-primary/10 text-xs text-primary">
              💡 소희 추천: &quot;화요일 15:00 예약 가능합니다. 예약 링크 발송&quot;
            </div>
            <div className="flex gap-2 pt-1">
              <button className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold">
                추천 답변 발송
              </button>
              <button className="px-3 py-2 rounded-xl border border-[var(--v088-border)] text-xs font-bold">
                직접 상담
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Mobile More & Kill Switch View (ANI-211) */}
      {activeMobileTab === 'more' && (
        <div className="space-y-4">
          <h3 className="font-bold text-base text-[var(--v088-ink)]">운영 및 안전 제어</h3>

          {/* Revenue quick widget */}
          <div className="p-4 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] flex justify-between items-center">
            <div>
              <span className="text-xs text-[var(--v088-muted)] block">이번 주 확정 매출</span>
              <span className="text-lg font-bold font-mono text-[var(--v088-ink)]">540,000원</span>
            </div>
            <span className="text-xs text-primary font-bold">6개 슬롯 예약</span>
          </div>

          {/* Emergency Kill Switch */}
          <div className="p-5 rounded-2xl bg-state-danger-soft/70 border border-state-danger/30 space-y-3">
            <div className="flex items-center gap-2 text-state-danger font-bold text-sm">
              <ShieldAlert className="w-4 h-4" />
              <span>긴급 킬스위치 (Kill Switch)</span>
            </div>
            <p className="text-xs text-state-danger">
              가동 시 소희의 모든 외부 게시 및 자동 발송이 즉시 전면 차단됩니다.
            </p>
            <button
              onClick={() => setKillSwitch(!killSwitch)}
              className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                killSwitch
                  ? 'bg-state-danger-soft text-state-danger'
                  : 'bg-white dark:bg-neutral-900 text-state-danger border border-state-danger/30'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{killSwitch ? '⚠️ 킬스위치 가동 중' : '킬스위치 켜기'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
