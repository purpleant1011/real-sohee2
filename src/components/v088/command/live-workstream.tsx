'use client'

import React, { useState } from 'react'
import { 
  Sparkles, 
  Search, 
  FileEdit, 
  ShieldCheck, 
  AlertCircle, 
  Cpu, 
  CheckCircle2, 
  MessageSquare, 
  CalendarCheck, 
  Coins, 
  Brain,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Code
} from 'lucide-react'

export type WorkstreamEventType =
  | 'strategy_created'
  | 'opportunity_detected'
  | 'mission_planned'
  | 'quality_checked'
  | 'decision_requested'
  | 'action_executed'
  | 'provider_accepted'
  | 'externally_verified'
  | 'customer_replied'
  | 'booking_changed'
  | 'revenue_realized'
  | 'learning_created'

export interface WorkstreamEvent {
  id: string
  timestamp: string
  type: WorkstreamEventType
  title: string
  summary: string
  explanation?: string
  tracePayload?: Record<string, unknown>
  externalUrl?: string
  status: 'success' | 'running' | 'warning' | 'failed'
}

interface LiveWorkstreamProps {
  events?: WorkstreamEvent[]
}

const EVENT_ICONS: Record<WorkstreamEventType, React.ComponentType<{ className?: string }>> = {
  strategy_created: Brain,
  opportunity_detected: Search,
  mission_planned: Sparkles,
  quality_checked: ShieldCheck,
  decision_requested: AlertCircle,
  action_executed: Cpu,
  provider_accepted: CheckCircle2,
  externally_verified: CheckCircle2,
  customer_replied: MessageSquare,
  booking_changed: CalendarCheck,
  revenue_realized: Coins,
  learning_created: Brain,
}

export function LiveWorkstream({
  events = [
    {
      id: 'ev-1',
      timestamp: '12:35',
      type: 'quality_checked',
      title: '네이버 블로그 게시물 사전 품질 검사 완료 (점수: 96/100)',
      summary: '브랜드 가이드라인 100% 충족, 의료법/과대광고 금지어 0건, 지역 키워드 밀도 최적',
      explanation: '소희 품질 게이트가 4개 항목(Brand Fit, Claim Safety, Timing, CTA Clarity)을 전수 검사하여 승인 대기 큐로 승격했습니다.',
      tracePayload: {
        score: 96,
        brandCompliance: 'PASS',
        claimSafety: 'PASS',
        targetKeyword: '동네 인기 메뉴',
        checkedAt: '2026-08-31T12:35:10Z'
      },
      status: 'success'
    },
    {
      id: 'ev-2',
      timestamp: '12:20',
      type: 'action_executed',
      title: '네이버 블로그 및 인스타그램 콘텐츠 초안 생성',
      summary: '매장 맞춤형 서비스 스토리텔링 및 예약 안내 문구 생성 완료',
      explanation: 'OpenAI GPT-4o 기반 소희 마케팅 프롬프트 엔진을 통해 2개 채널 맞춤형 포스팅 카피를 생성했습니다.',
      status: 'success'
    },
    {
      id: 'ev-3',
      timestamp: '11:45',
      type: 'customer_replied',
      title: '인스타그램 DM 문의 자동 분석 및 맞춤 답변 추천',
      summary: '고객 @minji_kim 서비스 문의 접수 → 맞춤 상담 안내 초안 전달',
      explanation: '고객의 질문 의도를 분석하여 과거 이용 이력 확인 질문 및 자연스러운 예약 링크를 제안했습니다.',
      status: 'success'
    },
    {
      id: 'ev-4',
      timestamp: '09:00',
      type: 'strategy_created',
      title: '오늘의 모닝 브리핑 및 주간 집중 미션 수립',
      summary: '화/수/목 오후 유휴 슬롯 6개 소진을 위한 봄맞이 프로모션 가동 결정',
      status: 'success'
    }
  ]
}: LiveWorkstreamProps) {
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null)
  const [detailMode, setDetailMode] = useState<'summary' | 'explain' | 'trace'>('summary')

  return (
    <div className="p-5 md:p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-state-wait" />
          <h3 className="font-bold text-base tracking-tight">실시간 업무 타임라인</h3>
        </div>

        {/* View Depth Segmented Control */}
        <div className="flex items-center p-1 rounded-xl bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] text-xs font-semibold">
          <button
            onClick={() => setDetailMode('summary')}
            className={`px-3 py-1 rounded-lg transition-all ${
              detailMode === 'summary'
                ? 'bg-[var(--v088-surface)] text-foreground dark:text-primary shadow-sm'
                : 'text-[var(--v088-muted)] hover:text-[var(--v088-ink)]'
            }`}
          >
            요약
          </button>
          <button
            onClick={() => setDetailMode('explain')}
            className={`px-3 py-1 rounded-lg transition-all ${
              detailMode === 'explain'
                ? 'bg-[var(--v088-surface)] text-foreground dark:text-primary shadow-sm'
                : 'text-[var(--v088-muted)] hover:text-[var(--v088-ink)]'
            }`}
          >
            판단 근거
          </button>
          <button
            onClick={() => setDetailMode('trace')}
            className={`px-3 py-1 rounded-lg transition-all ${
              detailMode === 'trace'
                ? 'bg-[var(--v088-surface)] text-foreground dark:text-primary shadow-sm'
                : 'text-[var(--v088-muted)] hover:text-[var(--v088-ink)]'
            }`}
          >
            실행 로그
          </button>
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1px] before:bg-[var(--v088-border)]">
        {events.map((ev) => {
          const Icon = EVENT_ICONS[ev.type] || Sparkles
          return (
            <div key={ev.id} className="relative group">
              {/* Timeline Bullet */}
              <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-[var(--v088-surface)] border-2 border-primary/50 flex items-center justify-center shadow-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              </div>

              {/* Event Content */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-[var(--v088-muted)]">{ev.timestamp}</span>
                  <h4 className="font-semibold text-sm text-[var(--v088-ink)] flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    <span>{ev.title}</span>
                  </h4>
                </div>

                <p className="text-xs text-[var(--v088-muted)] leading-relaxed">{ev.summary}</p>

                {/* Explain Mode */}
                {(detailMode === 'explain' || detailMode === 'trace') && ev.explanation && (
                  <div className="mt-2 p-3 rounded-xl bg-primary/50 border border-primary/15 text-xs text-[var(--v088-ink)] leading-relaxed">
                    <span className="font-semibold text-foreground dark:text-primary block mb-0.5">
                      💡 소희의 판단 근거:
                    </span>
                    {ev.explanation}
                  </div>
                )}

                {/* Trace Mode / Raw Payload */}
                {detailMode === 'trace' && ev.tracePayload && (
                  <div className="mt-2">
                    <button
                      onClick={() => setExpandedTraceId(expandedTraceId === ev.id ? null : ev.id)}
                      className="text-[11px] font-mono text-[var(--v088-muted)] hover:text-primary flex items-center gap-1 cursor-pointer"
                    >
                      <Code className="w-3 h-3" />
                      <span>{expandedTraceId === ev.id ? 'JSON Payload 접기' : 'Raw Trace JSON 보기'}</span>
                    </button>
                    {expandedTraceId === ev.id && (
                      <pre className="mt-1 p-3 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-[11px] overflow-x-auto">
                        {JSON.stringify(ev.tracePayload, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {ev.externalUrl && (
                  <a
                    href={ev.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>실제 발행 결과 확인</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
