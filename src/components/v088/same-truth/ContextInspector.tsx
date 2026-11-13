'use client'

import React, { useState } from 'react'
import { Brain, Database, ShieldAlert, Sparkles, ChevronDown, ChevronUp, CheckCircle2, RefreshCw } from 'lucide-react'
import { PersistenceStateBadge } from './PersistenceStateBadge'

export interface ContextInspectorProps {
  workspaceId: string
  businessProfile?: {
    businessName: string
    industry: string
    location: string
    summary: string
  } | null
  brandProfile?: {
    voice: string
    keywords: string[]
    prohibitedTerms: string[]
  } | null
  durableMemoryCount?: number
  agentRunId?: string | null
  persistenceState?: 'DIRTY' | 'SAVING' | 'PERSISTED' | 'READBACK_VERIFIED' | 'PERSISTENCE_FAILED'
  onRefresh?: () => void
}

export function ContextInspector({
  workspaceId,
  businessProfile,
  brandProfile,
  durableMemoryCount = 0,
  agentRunId,
  persistenceState = 'READBACK_VERIFIED',
  onRefresh,
}: ContextInspectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  const hasProfile = Boolean(businessProfile?.businessName || brandProfile?.voice)

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121215] shadow-xs overflow-hidden">
      <div className="p-4 flex items-center justify-between gap-3 bg-zinc-50/70 dark:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>소희 직원 런타임 맥락 인스펙터 (Canonical Context)</span>
              <PersistenceStateBadge state={persistenceState} />
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              실시간 DB 동기화 맥락 주입 상태
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="맥락 새로고침"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 transition-colors"
          >
            <span>{isOpen ? '접기' : '상세 맥락 확인'}</span>
            {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-5 space-y-4 text-xs">
          {!hasProfile ? (
            <div className="p-4 rounded-xl bg-state-warn-soft border border-state-warn/30 text-state-warn space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-state-warn" />
                <span>영속화된 사업장 프로필이 없습니다</span>
              </div>
              <p className="text-[11px] text-state-warn">
                소희가 기본 매뉴얼로만 응대합니다. 아래 폼에서 매장 프로필을 저장하면 실제 원장에 영속화됩니다.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 space-y-2">
                <span className="text-[11px] font-bold text-zinc-400 block">비즈니스 정본 (Business Profile)</span>
                <div className="space-y-1">
                  <div className="text-zinc-900 dark:text-zinc-100 font-bold">
                    상호: {businessProfile?.businessName || '미설정'}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">
                    업종: {businessProfile?.industry || '미설정'}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">
                    위치: {businessProfile?.location || '미설정'}
                  </div>
                  <div className="text-zinc-500 dark:text-zinc-500 text-[11px] line-clamp-2">
                    강점: {businessProfile?.summary || '미설정'}
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 space-y-2">
                <span className="text-[11px] font-bold text-zinc-400 block">브랜드 톤 & 규정 (Brand Profile)</span>
                <div className="space-y-1">
                  <div className="text-zinc-900 dark:text-zinc-100 font-bold">
                    보이스: {brandProfile?.voice || '표준 친절체'}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">
                    키워드: {brandProfile?.keywords?.join(', ') || '없음'}
                  </div>
                  <div className="text-state-danger text-[11px]">
                    금지어: {brandProfile?.prohibitedTerms?.join(', ') || '없음'}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-mono">
                <Database className="w-3.5 h-3.5 text-primary" />
                <span>장기 기억(Durable Memory): {durableMemoryCount}건</span>
              </span>
              {agentRunId && (
                <span className="font-mono bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 rounded">
                  Run ID: {agentRunId}
                </span>
              )}
            </div>
            <span className="text-state-ok font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Fail-Closed 주입 보장
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
