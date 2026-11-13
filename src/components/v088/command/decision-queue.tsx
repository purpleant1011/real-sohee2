'use client'

import React, { useState } from 'react'
import { 
  AlertTriangle, 
  Check, 
  X, 
  Edit3, 
  Eye, 
  Sparkles, 
  ArrowRight, 
  Clock, 
  ShieldAlert, 
  TrendingUp,
  CheckCircle2
} from 'lucide-react'
import { useCreditBalance } from '@/hooks/use-credit-balance'

export interface DecisionItem {
  id: string
  title: string
  category: 'content_publish' | 'price_discount' | 'customer_reply' | 'campaign_budget' | 'policy_change'
  urgency: 'critical' | 'high' | 'medium'
  riskTier: 'R1' | 'R2'
  whyNow: string
  expectedEffect: string
  riskAndCost: string
  previewContent?: {
    headline?: string
    body?: string
    channel?: string
    imageUrl?: string
  }
  expiresAt: string
  recommendation: 'approve' | 'modify' | 'reject'
  nextActionsOnApprove: string[]
  canPromoteToAutonomy?: boolean
}

interface DecisionQueueProps {
  decisions?: DecisionItem[]
  onApprove?: (id: string) => void
  onReject?: (id: string, reason?: string) => void
  onModify?: (id: string) => void
  onPromoteAutonomy?: (id: string) => void
}

export function DecisionQueue({
  decisions = [
    {
      id: 'dec-1',
      title: '네이버 블로그 [봄맞이 첫 방문 서비스 가이드] 발행 승인',
      category: 'content_publish',
      urgency: 'high',
      riskTier: 'R2',
      whyNow: '주말 대비 주중 검색 트래픽 선점을 위해 오늘 오후 2시 전 발행 필요',
      expectedEffect: '지역 검색 상위 노출 → 주간 예약 문의 4~6건 증대',
      riskAndCost: '네이버 블로그 실제 공개 발행 (브랜드 이미지 영향)',
      previewContent: {
        headline: '봄맞이 맞춤 서비스: 첫 방문 고객을 위한 1:1 안내',
        body: '우리 매장만의 정성스러운 1:1 맞춤 상담 프로세스를 소개합니다...',
        channel: '네이버 블로그'
      },
      expiresAt: '오늘 14:00',
      recommendation: 'approve',
      nextActionsOnApprove: [
        '네이버 블로그 스마트에디터 ONE 포스팅 실행',
        '외부 발행 URL 수신 및 상태 검증',
        '인스타그램 연계 스토리 발행 대기열 등록'
      ],
      canPromoteToAutonomy: true
    },
    {
      id: 'dec-2',
      title: '주중 화/수 첫 방문 고객 15% 할인 프로모션 오퍼 적용',
      category: 'price_discount',
      urgency: 'medium',
      riskTier: 'R2',
      whyNow: '화요일/수요일 오후 2~5시 유휴 슬롯 4개 예약 전환율 향상',
      expectedEffect: '예약 문의 전환율 22% → 48% 상승, 슬롯 4개 조기 마감',
      riskAndCost: '건당 15,000원 할인 적용',
      expiresAt: '내일 10:00',
      recommendation: 'approve',
      nextActionsOnApprove: [
        '당근마켓 소식란 쿠폰 등록',
        '인스타그램 예약 프로필 링크에 할인 안내 뱃지 부착'
      ],
      canPromoteToAutonomy: false
    }
  ],
  onApprove,
  onReject,
  onModify,
  onPromoteAutonomy
}: DecisionQueueProps) {
  const { consumeCredits } = useCreditBalance()
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [modifyingId, setModifyingId] = useState<string | null>(null)
  const [modifyReason, setModifyReason] = useState('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const showNotification = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  const handleApproveClick = (id: string) => {
    setCompletedIds(prev => new Set(prev).add(id))
    consumeCredits(35)
    showNotification('✓ 즉시 승인 완료 — 실행 체인이 시작되었습니다')
    onApprove?.(id)
  }

  const handleRejectClick = (id: string) => {
    setCompletedIds(prev => new Set(prev).add(id))
    showNotification('✕ 항목이 반려되었습니다.')
    onReject?.(id)
  }

  const handlePromoteClick = (id: string) => {
    showNotification('✨ 다음부터 이 유형의 작업이 자율 자동 실행으로 등록되었습니다.')
    onPromoteAutonomy?.(id)
  }

  const handleModifySubmit = (id: string) => {
    if (!modifyReason.trim()) return
    showNotification(`📝 수정 피드백이 전달되었습니다: "${modifyReason}"`)
    setModifyingId(null)
    setModifyReason('')
    onModify?.(id)
  }

  if (decisions.length === 0 || decisions.every(d => completedIds.has(d.id))) {
    return (
      <div className="p-6 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-center">
        <CheckCircle2 className="w-8 h-8 text-state-ok mx-auto mb-2" />
        <h3 className="font-semibold text-sm">지금 결정이 필요한 사항이 없습니다</h3>
        <p className="text-xs text-[var(--v088-muted)] mt-1">소희가 부여된 권한 내에서 안전하게 업무를 수행하고 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-state-warn animate-pulse" />
          <h3 className="font-bold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
            확인이 필요한 일
          </h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-state-warn-soft text-state-warn font-bold">
            {decisions.filter(d => !completedIds.has(d.id)).length}건 대기
          </span>
        </div>
        <span className="text-xs text-[var(--v088-muted)] hidden sm:inline">
          승인 즉시 다음 작업이 바로 시작됩니다
        </span>
      </div>

      <div className="space-y-4">
        {decisions.filter(item => !completedIds.has(item.id)).map((item) => (
          <div
            key={item.id}
            className="p-5 rounded-2xl bg-[var(--v088-surface)] border border-[var(--v088-border)] hover:border-primary/40 dark:hover:border-primary transition-all shadow-xs space-y-4"
          >
            {/* Urgency & Risk Badges */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-state-warn-soft text-state-warn dark:bg-state-warn/60 dark:text-state-warn">
                  {item.urgency === 'critical' ? '🚨 긴급' : item.urgency === 'high' ? '⚡ 오늘 마감' : '⏳ 결정 권장'}
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-state-danger-soft text-state-danger dark:bg-state-danger/60 dark:text-state-danger border border-state-danger/30">
                  {item.riskTier} 위험도
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-[var(--v088-muted)] font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>만료: {item.expiresAt}</span>
              </div>
            </div>

            {/* Title */}
            <h4 className="text-base md:text-lg font-bold mb-3 text-[var(--v088-ink)]">
              {item.title}
            </h4>

            {/* Why Now & Effect Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[var(--v088-surface-subtle)] text-xs mb-4">
              <div>
                <span className="font-semibold text-[var(--v088-muted)] block mb-1">
                  🔍 왜 지금 결정해야 하나요?
                </span>
                <p className="text-[var(--v088-ink)] leading-relaxed">{item.whyNow}</p>
              </div>
              <div>
                <span className="font-semibold text-state-ok block mb-1">
                  📈 예상 비즈니스 효과
                </span>
                <p className="text-[var(--v088-ink)] leading-relaxed">{item.expectedEffect}</p>
              </div>
            </div>

            {/* Preview Box toggle if available */}
            {item.previewContent && (
              <div className="mb-4">
                <button
                  onClick={() => setActivePreviewId(activePreviewId === item.id ? null : item.id)}
                  className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{activePreviewId === item.id ? '게시 초안 미리보기 닫기' : '게시 초안 미리보기'}</span>
                </button>

                {activePreviewId === item.id && (
                  <div className="mt-2.5 p-4 rounded-xl bg-primary/50 border border-primary/30 text-xs">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/20 text-foreground dark:text-primary uppercase tracking-wider mb-2 inline-block">
                      {item.previewContent.channel}
                    </span>
                    <h5 className="font-bold text-sm mb-1.5">{item.previewContent.headline}</h5>
                    <p className="text-[var(--v088-muted)] leading-relaxed whitespace-pre-line">
                      {item.previewContent.body}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Next Actions on Approve */}
            <div className="mb-4 text-xs">
              <span className="text-[11px] font-semibold text-[var(--v088-muted)] block mb-1">
                승인 시 실행될 액션 체인 (Action Chain):
              </span>
              <ul className="space-y-1">
                {item.nextActionsOnApprove.map((action, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[var(--v088-ink)]">
                    <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action Buttons Bar */}
            <div className="pt-3 border-t border-[var(--v088-border)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {item.canPromoteToAutonomy && (
                  <button
                    onClick={() => handlePromoteClick(item.id)}
                    className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>다음부터 자동 실행으로 등록</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setModifyingId(modifyingId === item.id ? null : item.id)}
                  className="flex-1 sm:flex-initial px-3 py-2 rounded-xl text-xs font-semibold text-[var(--v088-muted)] hover:bg-[var(--v088-surface-subtle)] border border-[var(--v088-border)] transition-colors cursor-pointer"
                >
                  수정 요청
                </button>
                <button
                  onClick={() => handleRejectClick(item.id)}
                  className="flex-1 sm:flex-initial px-3 py-2 rounded-xl text-xs font-semibold text-state-danger hover:bg-state-danger-soft dark:hover:bg-state-danger/40 border border-state-danger/30 transition-colors cursor-pointer"
                >
                  반려
                </button>
                <button
                  onClick={() => handleApproveClick(item.id)}
                  className="flex-1 sm:flex-initial px-5 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>즉시 승인</span>
                </button>
              </div>
            </div>

            {/* 인라인 수정 요청 입력창 */}
            {modifyingId === item.id && (
              <div className="mt-3 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block">
                  소희에게 전달할 수정 피드백 입력:
                </label>
                <input
                  type="text"
                  value={modifyReason}
                  onChange={e => setModifyReason(e.target.value)}
                  placeholder="예: 톤을 조금 더 다정하게 바꾸고, 주말 예약 링크도 추가해줘"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setModifyingId(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleModifySubmit(item.id)}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary/90 text-white shadow-sm"
                  >
                    피드백 전송
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Floating Toast Message */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl bg-zinc-900 text-white text-xs font-semibold shadow-2xl border border-zinc-700 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  )
}
