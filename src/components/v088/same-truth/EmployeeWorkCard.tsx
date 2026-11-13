'use client'

import React from 'react'
import {
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Sparkles,
  RefreshCw,
  Tag,
} from 'lucide-react'
import Link from 'next/link'
import type { CanonicalEmployeeWorkItem } from '@/features/canonical-read-model/types'

export interface EmployeeWorkCardProps {
  item: CanonicalEmployeeWorkItem
  onApprove?: (itemId: string) => void
  onReject?: (itemId: string) => void
  onRetry?: (itemId: string) => void
}

export function EmployeeWorkCard({
  item,
  onApprove,
  onReject,
  onRetry,
}: EmployeeWorkCardProps) {
  const isApprovalRequired = item.status === 'approval_required'
  const isCompleted = item.status === 'completed'
  const isFailed = item.status === 'failed'

  const categoryBadge: Record<string, { label: string; bg: string }> = {
    comment: { label: '댓글 (Comment)', bg: 'bg-state-wait-soft text-state-wait dark:bg-state-wait dark:text-state-wait' },
    dm: { label: 'DM 문의', bg: 'bg-primary/10 text-foreground dark:bg-primary dark:text-primary' },
    mention: { label: '멘션 (Mention)', bg: 'bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok' },
    reply: { label: '답글 (Reply)', bg: 'bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn' },
    reconnect_needed: { label: '재인증 필요', bg: 'bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn' },
    action_failed: { label: '실행 실패', bg: 'bg-state-danger-soft text-state-danger dark:bg-state-danger dark:text-state-danger' },
  }
  const currentBadge = categoryBadge[item.category] || { label: item.category, bg: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' }

  return (
    <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121215] shadow-xs space-y-4 transition-all hover:border-primary/40 dark:hover:border-primary">
      {/* Card Header: Trigger, Category, Timestamps, Deep Link */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${currentBadge.bg}`}>
                {currentBadge.label}
              </span>
              <h4 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                {item.title}
              </h4>
            </div>

            <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                <span>수신 시각: {item.occurredAt}</span>
              </span>
              {item.externalTargetId && (
                <span className="font-mono bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 rounded text-[10px]">
                  ID: {item.externalTargetId}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* State Badge */}
        <div>
          {isApprovalRequired && (
            <span className="px-2.5 py-1 rounded-full bg-state-warn-soft text-state-warn text-xs font-bold border border-state-warn/40 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-state-warn" />
              <span>사장님 승인 대기</span>
            </span>
          )}
          {isCompleted && (
            <span className="px-2.5 py-1 rounded-full bg-state-ok-soft text-state-ok text-xs font-bold border border-state-ok/40 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
              <span>실행 및 증거 완료</span>
            </span>
          )}
          {isFailed && (
            <span className="px-2.5 py-1 rounded-full bg-state-danger-soft text-state-danger text-xs font-bold border border-state-danger/40 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 text-state-danger" />
              <span>실행 실패 (복구 필요)</span>
            </span>
          )}
        </div>
      </div>

      {/* Context & Policy Summary (Figma 77:77 Completion Contract) */}
      <div className="space-y-2">
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium">
          <div className="text-[11px] font-bold text-zinc-400 mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" />
            <span>상황 맥락 및 규정 검토 결과 (Policy Summary)</span>
          </div>
          {item.summary}
        </div>
      </div>

      {/* Completion Details if completed */}
      {isCompleted && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl bg-state-ok/50 border border-state-ok/80 text-xs">
          <div>
            <span className="text-[10px] text-zinc-400 block font-bold">처리 및 실측 확인 (Verified)</span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100 text-[11px]">
              외부 응답 전송 + Readback 영수증 대사 완료
            </span>
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 block font-bold">다음 후속 조치 (Next Follow-up)</span>
            <span className="text-state-ok font-bold text-[11px]">
              고객 재문의 모니터링 및 예약 슬롯 확보 대기
            </span>
          </div>
        </div>
      )}

      {/* Actions: Approve / Reject / Retry / Deep-link */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-zinc-100 dark:border-zinc-900">
        <div className="flex items-center gap-2">
          {item.externalTargetId && (
            <Link
              href={`/app/conversations?target=${item.externalTargetId}`}
              className="text-xs font-bold text-primary hover:text-primary flex items-center gap-1"
            >
              <span>스레드 대화 보기</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isFailed && onRetry && (
            <button
              onClick={() => onRetry(item.id)}
              className="px-3.5 py-1.5 rounded-xl bg-state-danger hover:bg-state-danger/90 text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>재시도</span>
            </button>
          )}

          {isApprovalRequired && (
            <>
              {onReject && (
                <button
                  onClick={() => onReject(item.id)}
                  className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  반려
                </button>
              )}
              {onApprove && (
                <button
                  onClick={() => onApprove(item.id)}
                  className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                >
                  <span>답변 승인 및 외부 전송</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
