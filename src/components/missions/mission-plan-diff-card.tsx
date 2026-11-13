'use client'

import React, { useState } from 'react'
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlanDiff } from '@/lib/mission-os/mission-plan-diff'

interface MissionPlanDiffCardProps {
  diff?: PlanDiff
  planDiff?: PlanDiff
  onApprove?: (diff: PlanDiff) => Promise<void> | void
  onReject?: () => void
  isSubmitting?: boolean
  isApplying?: boolean
  error?: string | null
}

export function MissionPlanDiffCard({
  diff: directDiff,
  planDiff,
  onApprove,
  onReject,
  isSubmitting = false,
  isApplying = false,
  error = null,
}: MissionPlanDiffCardProps) {
  const diff = directDiff || planDiff
  const submitting = isSubmitting || isApplying
  const [internalError, setInternalError] = useState<string | null>(null)

  if (!diff) {
    return null
  }

  const handleApprove = async () => {
    setInternalError(null)
    try {
      if (onApprove) {
        await onApprove(diff)
      }
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : '계획 승인 중 문제가 발생했습니다.')
    }
  }

  const formatCostDiff = (minorUnits: number) => {
    if (minorUnits === 0) return '0원 (기존 예산 유지)'
    const abs = Math.abs(minorUnits).toLocaleString()
    return minorUnits < 0 ? `-${abs}원` : `+${abs}원`
  }

  return (
    <div
      className="w-full max-w-md rounded-2xl bg-white border border-[#eae7ef] p-4 shadow-xs font-sans space-y-3"
      style={{ backgroundColor: '#ffffff', borderColor: '#eae7ef' }}
      aria-label="미션 계획 변경 카드"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#f3f0ff] text-[#6d4aff] border border-[#dcd4fc]">
            검토 필요
          </span>
          <span className="text-xs font-semibold text-slate-800">계획 변경안</span>
        </div>
        <span className="text-[11px] font-medium text-slate-500">
          v{diff.old_contract_version} → v{diff.new_contract_version}
        </span>
      </div>

      {/* Changed Items Summary */}
      <div className="space-y-1.5 bg-[#faf9f7] p-3 rounded-xl border border-[#eae7ef]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <FileText className="w-3.5 h-3.5 text-[#6d4aff]" />
          <span>변경 사항</span>
        </div>
        {diff.changed_fields.length === 0 ? (
          <p className="text-xs text-slate-500 pl-5">변경된 조건이 없습니다.</p>
        ) : (
          <ul className="space-y-1 pl-5">
            {diff.changed_fields.map((f, idx) => (
              <li key={`card-field-${idx}`} className="text-xs text-slate-800">
                {f.description_ko}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preserved Budget & Cost */}
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-slate-600">예산 변동 차액</span>
        <span className="font-semibold text-slate-900">
          {formatCostDiff(diff.cost_difference_minor_units)}
        </span>
      </div>

      {/* Unexecuted Steps Impact Note */}
      {diff.impacted_unexecuted_steps.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>
            미실행 단계 {diff.impacted_unexecuted_steps.length}개가 새 계획에 맞춰 자동으로 조정됩니다.
          </span>
        </div>
      )}

      {/* Re-approval requirement notice */}
      {diff.requires_reapproval && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#6d4aff] px-1 font-medium">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span>실제 외부 전송 전 사장님의 확인 승인이 필요합니다.</span>
        </div>
      )}

      {/* Errors */}
      {(error || internalError) && (
        <p role="alert" className="text-xs text-red-600 font-medium px-1">
          {error || internalError}
        </p>
      )}

      {/* Action Buttons (Figma M20 style) */}
      <div className="flex items-center gap-2 pt-1">
        {onReject && (
          <Button
            type="button"
            variant="outline"
            className="flex-1 text-xs border-[#eae7ef] text-slate-700 hover:bg-slate-50 min-h-11 cursor-pointer"
            onClick={onReject}
            disabled={submitting}
          >
            취소
          </Button>
        )}
        <Button
          type="button"
          className="flex-1 text-xs font-semibold text-white bg-[#6d4aff] hover:bg-[#5b3ce0] min-h-11 flex items-center justify-center gap-1 cursor-pointer"
          onClick={handleApprove}
          disabled={submitting}
        >
          {submitting ? (
            '반영 중…'
          ) : (
            <>
              <span>계획 승인하기</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
