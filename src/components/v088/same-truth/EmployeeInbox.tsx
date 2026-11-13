'use client'

import React, { useState, useMemo } from 'react'
import { MessageSquare, ArrowRight, ShieldAlert, CheckCircle2, Clock, ExternalLink, Filter } from 'lucide-react'
import { EmptyEvidenceState } from './EmptyEvidenceState'
import { EmployeeWorkCard } from './EmployeeWorkCard'
import type { CanonicalEmployeeWorkItem } from '@/features/canonical-read-model/types'

export interface EmployeeInboxProps {
  items: CanonicalEmployeeWorkItem[]
  onApprove?: (itemId: string) => void
  onReject?: (itemId: string) => void
  onRetry?: (itemId: string) => void
}

export function EmployeeInbox({ items = [], onApprove, onReject, onRetry }: EmployeeInboxProps) {
  const [filter, setFilter] = useState<'all' | 'approval_required' | 'completed' | 'failed'>('all')

  const filteredItems = useMemo(() => {
    if (!items) return []
    if (filter === 'all') return items
    return items.filter((item) => item.status === filter)
  }, [items, filter])

  const counts = useMemo(() => {
    if (!items) return { all: 0, approval_required: 0, completed: 0, failed: 0 }
    return {
      all: items.length,
      approval_required: items.filter((i) => i.status === 'approval_required').length,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
    }
  }, [items])

  if (!items || items.length === 0) {
    return (
      <EmptyEvidenceState
        title="처리 대기 중인 소희 업무가 없습니다"
        description="인스타그램/스레드 댓글, DM, 멘션 등 외부 이벤트가 수신되면 소희가 맥락을 판단하여 자율 처리하거나 승인 대기 카드를 생성합니다."
        kind="NO_PROOF"
        actionLabel="채널 준비도 확인하기"
        actionHref="/app/channels"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-bold">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            전체 업무 ({counts.all})
          </button>
          <button
            onClick={() => setFilter('approval_required')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              filter === 'approval_required'
                ? 'bg-white dark:bg-zinc-800 text-state-warn shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            승인 대기 ({counts.approval_required})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              filter === 'completed'
                ? 'bg-white dark:bg-zinc-800 text-state-ok shadow-2xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            실측 완료 ({counts.completed})
          </button>
          {counts.failed > 0 && (
            <button
              onClick={() => setFilter('failed')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                filter === 'failed'
                  ? 'bg-white dark:bg-zinc-800 text-state-danger shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              장애 복구 ({counts.failed})
            </button>
          )}
        </div>

        <span className="text-[11px] text-zinc-400 font-mono">
          총 {filteredItems.length}건 정본 대사 중
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyEvidenceState
          title="선택된 조건에 해당하는 업무가 없습니다"
          description="다른 탭을 선택하여 소희의 다른 업무 처리 내역을 확인하실 수 있습니다."
          kind="NO_PROOF"
        />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <EmployeeWorkCard
              key={item.id}
              item={item}
              onApprove={onApprove}
              onReject={onReject}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </div>
  )
}
