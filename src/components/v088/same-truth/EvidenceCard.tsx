'use client'

import React from 'react'
import { ExternalLink, ShieldCheck, Hash, Calendar, FileText, CheckCircle2 } from 'lucide-react'
import { EmptyEvidenceState } from './EmptyEvidenceState'

export interface EvidenceCardProps {
  receiptId?: string
  provider?: 'instagram' | 'threads' | 'naver' | 'daangn' | 'system'
  providerId?: string
  permalink?: string
  evidenceHash?: string
  occurredAt?: string
  verifiedAt?: string
  status?: 'VERIFIED' | 'PENDING' | 'NO_PROOF' | 'FAILED'
  summary?: string
  metadata?: Record<string, any>
}

export function EvidenceCard({
  receiptId,
  provider = 'instagram',
  providerId,
  permalink,
  evidenceHash,
  occurredAt,
  verifiedAt,
  status = 'VERIFIED',
  summary,
  metadata,
}: EvidenceCardProps) {
  if (status === 'NO_PROOF' || (!receiptId && !permalink && !evidenceHash)) {
    return (
      <EmptyEvidenceState
        title="확인된 외부 게시 확인 내역이 없습니다"
        description="실제 외부 채널(인스타그램/네이버) 공식 연결 성공 확인과 게시물 일치 기록이 확인되면 여기에 안전한 확인 기록과 함께 표시됩니다."
        kind="NO_PROOF"
      />
    )
  }

  const providerLabel = {
    instagram: '인스타그램 (Instagram)',
    threads: '스레드 (Threads)',
    naver: '네이버 블로그 (Naver)',
    daangn: '당근마켓 (Daangn)',
    system: '시스템 원장 (System)',
  }[provider]

  return (
    <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121215] shadow-xs space-y-4">
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>{providerLabel} 게시 확인 내역</span>
              {status === 'VERIFIED' && (
                <span className="px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok text-[10px] font-black flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> 확인됨
                </span>
              )}
              {status === 'PENDING' && (
                <span className="px-2 py-0.5 rounded-full bg-state-warn-soft text-state-warn text-[10px] font-black">
                  확인 대기 중
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
              확인 번호: {receiptId || '발급 대기'}
            </div>
          </div>
        </div>

        {permalink && (
          <a
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold transition-all"
          >
            <span>원문 보기</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {summary && (
        <div className="text-xs text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed bg-zinc-50 dark:bg-zinc-900/60 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
          {summary}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-medium">
        <div className="space-y-1">
          <span className="text-zinc-400 text-[11px] block">연결 채널 대상 번호</span>
          <span className="font-mono text-zinc-900 dark:text-zinc-100 break-all">
            {providerId || 'N/A'}
          </span>
        </div>

        <div className="space-y-1">
          <span className="text-zinc-400 text-[11px] block">게시 확인 일시</span>
          <span className="text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-zinc-400" />
            <span>{verifiedAt || occurredAt || 'N/A'}</span>
          </span>
        </div>

        {evidenceHash && (
          <div className="sm:col-span-2 space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <span className="text-zinc-400 text-[11px] flex items-center gap-1">
              <Hash className="w-3 h-3" /> 원본 일치 확인
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 block bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 rounded-lg">
              증거 기록이 저장돼 있어요
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
