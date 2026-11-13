import React from 'react'
import type { WorkboardProof } from '@/features/agent-os/workboard-types'
import { cn } from '@/lib/utils'
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react'

interface ProofSummaryProps {
  proof: WorkboardProof | null
  className?: string
}

export function ProofSummary({ proof, className }: ProofSummaryProps) {
  if (!proof) {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400', className)}>
        <Clock className="w-3.5 h-3.5 text-zinc-400" />
        <span>외부 검증 대기 중 (검증된 최근 작업 없음)</span>
      </div>
    )
  }

  const isVerified = proof.verificationState === 'VERIFIED'
  const isUnknown = proof.verificationState === 'RESULT_UNKNOWN'

  const formattedTime = proof.verifiedAt
    ? new Date(proof.verifiedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)}>
      {isVerified ? (
        <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-state-warn shrink-0" />
      )}

      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
          {proof.label}
        </span>
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded border',
            isVerified
              ? 'bg-state-ok-soft text-state-ok border-state-ok/30'
              : isUnknown
              ? 'bg-state-warn-soft text-state-warn border-state-warn/30'
              : 'bg-state-danger-soft text-state-danger border-state-danger/30'
          )}
        >
          {isVerified ? '확인됨' : isUnknown ? '확인 중' : '확인 필요'}
        </span>
        {formattedTime && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            ({formattedTime})
          </span>
        )}
      </div>
    </div>
  )
}
