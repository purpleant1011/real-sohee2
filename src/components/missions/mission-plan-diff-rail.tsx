'use client'

import React, { useState } from 'react'
import {
  FileText,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Layers,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlanDiff } from '@/lib/mission-os/mission-plan-diff'

interface MissionPlanDiffRailProps {
  diff?: PlanDiff | null
  planDiff?: PlanDiff | null
  onApplyPlan?: (diff: PlanDiff) => Promise<void> | void
  onRejectPlan?: () => void
  onApprove?: (diff: PlanDiff) => Promise<void> | void
  onReject?: () => void
  isApplying?: boolean
  error?: string | null
}

export function MissionPlanDiffRail({
  diff: directDiff,
  planDiff,
  onApplyPlan,
  onRejectPlan,
  onApprove,
  onReject,
  isApplying = false,
  error = null,
}: MissionPlanDiffRailProps) {
  const diff = directDiff !== undefined ? directDiff : planDiff ?? null
  const [internalError, setInternalError] = useState<string | null>(null)

  const handleApply = async () => {
    if (!diff) return
    setInternalError(null)
    try {
      if (onApplyPlan) {
        await onApplyPlan(diff)
      } else if (onApprove) {
        await onApprove(diff)
      }
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : '계획 적용 중 오류가 발생했습니다.')
    }
  }

  const handleCancel = () => {
    if (onRejectPlan) {
      onRejectPlan()
    } else if (onReject) {
      onReject()
    }
  }

  if (!diff) {
    return (
      <aside
        className="w-full lg:w-80 flex flex-col gap-3 p-4 rounded-2xl bg-white border border-[#eae7ef] shadow-xs text-sm font-sans"
        style={{ backgroundColor: '#ffffff', borderColor: '#eae7ef' }}
        aria-label="실행 계획 레일"
      >
        <div className="flex items-center gap-2 border-b border-[#eae7ef] pb-3">
          <Layers className="w-4 h-4 text-[#6d4aff]" />
          <h3 className="font-semibold text-slate-900 text-sm">실행 계획 레일</h3>
        </div>
        <div className="py-8 text-center text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-700">대기 중인 계획 변경안 없음</p>
          <p className="text-[11px] text-slate-400">
            대화창에서 &ldquo;인스타만 해줘, 예산 그대로&rdquo; 등을 요청하면 변경안(PlanDiff)이 여기에 표시됩니다.
          </p>
        </div>
      </aside>
    )
  }

  const formatCost = (minorUnits: number) => {
    const isNegative = minorUnits < 0
    const abs = Math.abs(minorUnits).toLocaleString()
    return isNegative ? `-${abs}원` : `+${abs}원`
  }

  return (
    <aside
      className="w-full lg:w-80 flex flex-col gap-4 p-4 rounded-2xl bg-white border border-[#eae7ef] shadow-xs text-sm font-sans"
      style={{ backgroundColor: '#ffffff', borderColor: '#eae7ef' }}
      aria-label="실행 계획 레일"
    >
      {/* Rail Header */}
      <div className="flex items-center justify-between border-b border-[#eae7ef] pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#6d4aff]" />
          <h3 className="font-semibold text-slate-900 text-sm">실행 계획 변경안</h3>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#f3f0ff] text-[#6d4aff] border border-[#dcd4fc]">
          v{diff.old_contract_version} → v{diff.new_contract_version}
        </span>
      </div>

      {/* Changed Scope Fields */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <FileText className="w-3.5 h-3.5 text-[#6d4aff]" />
          <span>변경된 계획 항목 ({diff.changed_fields.length}건)</span>
        </div>
        {diff.changed_fields.length === 0 ? (
          <p className="text-xs text-slate-500 pl-5">변경된 조건이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5 pl-5">
            {diff.changed_fields.map((f, idx) => (
              <li key={`field-${idx}`} className="text-xs text-slate-800 leading-snug">
                <span className="font-medium text-slate-900">{f.description_ko}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preserved Constraints */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>유지되는 제약 조건 ({diff.preserved_constraints.length}건)</span>
        </div>
        <ul className="space-y-1 pl-5">
          {diff.preserved_constraints.map((c, idx) => (
            <li key={`const-${idx}`} className="text-xs text-slate-600">
              {c}
            </li>
          ))}
        </ul>
      </div>

      {/* Cost Difference */}
      <div className="p-3 rounded-xl bg-[#faf9f7] border border-[#eae7ef] space-y-1">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
            예산 변동 차액
          </span>
          <span
            className={`font-semibold ${
              diff.cost_difference_minor_units > 0
                ? 'text-[#6d4aff]'
                : diff.cost_difference_minor_units < 0
                ? 'text-emerald-700'
                : 'text-slate-700'
            }`}
          >
            {diff.cost_difference_minor_units === 0
              ? '변동 없음 (0원)'
              : formatCost(diff.cost_difference_minor_units)}
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          기존 한도: {diff.proposed_contract.budget_caps.max_cost_minor_units.toLocaleString()}{' '}
          {diff.proposed_contract.budget_caps.currency}
        </p>
      </div>

      {/* Impacted Unexecuted Steps */}
      {diff.impacted_unexecuted_steps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            <span>영향받는 미실행 단계 ({diff.impacted_unexecuted_steps.length}개)</span>
          </div>
          <ul className="space-y-1 pl-5">
            {diff.impacted_unexecuted_steps.map((step, idx) => (
              <li key={`step-${idx}`} className="text-xs text-slate-600">
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Already Submitted Effects (Protected) */}
      {diff.already_submitted_effects.length > 0 && (
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">진행 완료된 작업 (보존됨)</p>
          <p className="text-[11px] text-slate-500 leading-tight">
            전송된 {diff.already_submitted_effects.length}건의 작업 결과를 안전하게 확인해요.
          </p>
        </div>
      )}

      {/* Approval Status & Actions */}
      <div className="pt-3 border-t border-[#eae7ef] space-y-2">
        {diff.requires_reapproval ? (
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#6d4aff]">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>범위 변경으로 사장님의 재승인이 필요해요</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>기존 승인 조건 내 안전한 변경안</span>
          </div>
        )}

        {(error || internalError) && (
          <p role="alert" className="text-xs text-red-600 font-medium">
            {error || internalError}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {(onRejectPlan || onReject) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 text-xs border-[#eae7ef] text-slate-700 hover:bg-slate-50 cursor-pointer"
              onClick={handleCancel}
              disabled={isApplying}
            >
              취소하기
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="flex-1 text-xs font-semibold text-white bg-[#6d4aff] hover:bg-[#5b3ce0] min-h-9 flex items-center justify-center gap-1 cursor-pointer"
            onClick={handleApply}
            disabled={isApplying}
          >
            {isApplying ? (
              '반영 중…'
            ) : (
              <>
                <span>계획 확정하기</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </aside>
  )
}
