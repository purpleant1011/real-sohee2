'use client'

import React, { useState } from 'react'
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Play,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RehearsalResult, PreLiveVerificationResult } from '@/lib/mission-os/mission-rehearsal'

interface MissionRehearsalCardProps {
  rehearsal: RehearsalResult
  verification?: PreLiveVerificationResult | null
  onPromoteToLive?: () => Promise<void> | void
  isPromoting?: boolean
  error?: string | null
}

export function MissionRehearsalCard({
  rehearsal,
  verification = null,
  onPromoteToLive,
  isPromoting = false,
  error = null,
}: MissionRehearsalCardProps) {
  const [internalError, setInternalError] = useState<string | null>(null)

  const handlePromote = async () => {
    setInternalError(null)
    try {
      if (onPromoteToLive) {
        await onPromoteToLive()
      }
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : '실서비스 전환 중 문제가 발생했습니다.')
    }
  }

  return (
    <div
      className="w-full max-w-md rounded-2xl bg-white border border-[#eae7ef] p-4 shadow-xs font-sans space-y-3"
      style={{ backgroundColor: '#ffffff', borderColor: '#eae7ef' }}
      aria-label="연습 리허설 결과 카드"
    >
      {/* Header Badge & Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#f3f0ff] text-[#6d4aff] border border-[#dcd4fc] flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#6d4aff]" />
            연습 리허설
          </span>
          <span className="text-xs font-semibold text-slate-800">외부 게시 0건</span>
        </div>
        <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          KPI 격리 보장
        </span>
      </div>

      {/* Safety Notice */}
      <div className="p-2.5 rounded-xl bg-[#faf9f7] border border-[#eae7ef] text-[11px] text-slate-600">
        <p className="font-semibold text-slate-800">
          실제 발송되지 않는 안전한 미리보기예요.
        </p>
      </div>

      {/* Timeline Steps Preview */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">모의 실행 내역 ({rehearsal.timeline_items.length}단계)</p>
        <ul className="space-y-1">
          {rehearsal.timeline_items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-slate-800">{item.title}</span>
              </div>
              <span className="text-[11px] text-slate-500">{item.time}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Pre-live Verification Block */}
      {verification && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold text-slate-700">실서비스 전환 사전 검증</p>
          {verification.canPromoteToLive ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>계정 권한 및 매장 정보 검증이 완료되었어요.</span>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200">
              <div className="flex items-center gap-1 font-semibold">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>진행 전 확인할 내용이 있어요:</span>
              </div>
              <ul className="list-disc pl-5 text-[11px] space-y-0.5">
                {verification.reasons.map((r, idx) => (
                  <li key={`verif-reason-${idx}`}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {(error || internalError) && (
        <p role="alert" className="text-xs text-red-600 font-medium px-1">
          {error || internalError}
        </p>
      )}

      {/* Promote to Live CTA */}
      {onPromoteToLive && (
        <div className="pt-2">
          <Button
            type="button"
            className="w-full text-xs font-semibold text-white bg-[#6d4aff] hover:bg-[#5b3ce0] min-h-11 flex items-center justify-center gap-1.5 cursor-pointer"
            onClick={handlePromote}
            disabled={isPromoting || (verification !== null && !verification.canPromoteToLive)}
          >
            {isPromoting ? (
              '실서비스 전환 중…'
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>실서비스로 전환하기</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
