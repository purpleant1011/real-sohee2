'use client'

import React from 'react'
import Link from 'next/link'
import { AlertCircle, HelpCircle } from 'lucide-react'

export interface EmptyEvidenceStateProps {
  title?: string
  description?: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  kind?: 'NO_PROOF' | 'NOT_VERIFIED' | 'UNKNOWN'
}

export function EmptyEvidenceState({
  title = '기록된 운영 증거가 없습니다',
  description = '실제 외부 채널 실행 및 독립 Readback 조회가 완료된 영수증만 이 화면에 정본으로 표시됩니다.',
  actionLabel,
  actionHref,
  onAction,
  kind = 'NO_PROOF',
}: EmptyEvidenceStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
      <div className="w-10 h-10 rounded-full bg-zinc-200/60 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 mb-3">
        {kind === 'NO_PROOF' ? (
          <HelpCircle className="w-5 h-5" />
        ) : (
          <AlertCircle className="w-5 h-5" />
        )}
      </div>
      <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</div>
      <p className="text-xs text-zinc-500 max-w-sm mt-1 leading-relaxed">
        {description}
      </p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold hover:bg-primary/90 dark:hover:bg-primary/90 dark:hover:text-white transition-colors cursor-pointer"
        >
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold hover:bg-primary/90 dark:hover:bg-primary/90 dark:hover:text-white transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
