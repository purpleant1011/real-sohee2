'use client'

import React from 'react'
import { CheckCircle2, Clock, XCircle, ExternalLink, ShieldCheck, ArrowRight } from 'lucide-react'

export interface ActionTimelineStep {
  step: number
  key: string
  label: string
  status: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED' | 'SKIPPED' | 'WAITING'
  detail?: string
  timestamp?: string
}

export interface ExternalActionTimelineProps {
  actionId: string
  channel: 'instagram' | 'threads' | 'naver' | 'daangn'
  actionType: string
  currentStage: string
  isSuccess?: boolean
  failureReason?: string
  receiptId?: string
  permalink?: string
  steps?: ActionTimelineStep[]
}

const DEFAULT_14_STEPS: { step: number; key: string; label: string }[] = [
  { step: 1, key: 'REQUEST_RECEIVED', label: '1. 요청 접수 및 검증' },
  { step: 2, key: 'IDEMPOTENCY_LOCKED', label: '2. 멱등키 잠금 (Lock)' },
  { step: 3, key: 'CONSENT_ENVELOPE_CHECKED', label: '3. 위임 동의 범위 확인' },
  { step: 4, key: 'CAPABILITY_GATE_CHECKED', label: '4. 역량 게이트 통과' },
  { step: 5, key: 'ATTEMPT_RECORDED', label: '5. 시도 원장 기록' },
  { step: 6, key: 'PAYLOAD_COMPOSED', label: '6. 페이로드 생성' },
  { step: 7, key: 'PROVIDER_API_CALLED', label: '7. 외부 Provider 전송' },
  { step: 8, key: 'PROVIDER_ACCEPTED', label: '8. Provider 200 수락' },
  { step: 9, key: 'READBACK_ATTEMPTED', label: '9. Readback 단방향 조회' },
  { step: 10, key: 'READBACK_VERIFIED', label: '10. 게시 실존 영수증 확인' },
  { step: 11, key: 'RECEIPT_PERSISTED', label: '11. 영수증 원장 영속화' },
  { step: 12, key: 'VERIFICATION_RPC_CALLED', label: '12. 검증 완료 RPC 호출' },
  { step: 13, key: 'WORKBOARD_SYNCED', label: '13. 워크보드 동기화' },
  { step: 14, key: 'DELIVERY_PROVED', label: '14. 최종 증거 완료' },
]

export function ExternalActionTimeline({
  actionId,
  channel,
  actionType,
  currentStage,
  isSuccess = true,
  failureReason,
  receiptId,
  permalink,
  steps,
}: ExternalActionTimelineProps) {
  const activeSteps = steps || DEFAULT_14_STEPS.map((s, idx) => {
    // Determine status based on currentStage
    let status: ActionTimelineStep['status'] = 'WAITING'
    if (isSuccess) {
      status = 'COMPLETED'
    } else if (failureReason && s.key === currentStage) {
      status = 'FAILED'
    } else if (idx < 7) {
      status = 'COMPLETED'
    } else if (idx === 7) {
      status = 'IN_PROGRESS'
    }
    return {
      ...s,
      status,
      detail: s.key === currentStage ? failureReason : undefined,
    }
  })

  return (
    <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121215] shadow-xs space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-foreground dark:text-primary text-xs font-bold uppercase">
              {channel} · {actionType}
            </span>
            <span className="text-xs font-mono text-zinc-400">
              ID: {actionId}
            </span>
          </div>
          <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 mt-1">
            Meta 14단계 퍼블리시 기록 타임라인
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {permalink && (
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-xs font-bold text-zinc-800 dark:text-zinc-200 transition-all"
            >
              <span>실제 게시물 링크</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {receiptId && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-state-ok-soft text-state-ok border border-state-ok/30 font-bold">
              영수증: {receiptId}
            </span>
          )}
        </div>
      </div>

      {failureReason && (
        <div className="p-3.5 rounded-xl bg-state-danger-soft border border-state-danger/30 text-state-danger text-xs font-bold flex items-center gap-2">
          <XCircle className="w-4 h-4 text-state-danger shrink-0" />
          <span>실행 중단 사유: {failureReason}</span>
        </div>
      )}

      {/* Grid of Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 pt-1">
        {activeSteps.map((step) => {
          let statusBadge = (
            <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" /> 대기
            </span>
          )
          let cardBg = 'bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200/70 dark:border-zinc-800'

          if (step.status === 'COMPLETED') {
            statusBadge = (
              <span className="text-[10px] text-state-ok font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> 통과
              </span>
            )
            cardBg = 'bg-state-ok/40 border-state-ok/30'
          } else if (step.status === 'FAILED') {
            statusBadge = (
              <span className="text-[10px] text-state-danger font-bold flex items-center gap-1">
                <XCircle className="w-3 h-3" /> 실패
              </span>
            )
            cardBg = 'bg-state-danger/50 border-state-danger/40'
          } else if (step.status === 'IN_PROGRESS') {
            statusBadge = (
              <span className="text-[10px] text-primary font-bold animate-pulse flex items-center gap-1">
                <Clock className="w-3 h-3" /> 진행 중
              </span>
            )
            cardBg = 'bg-primary/60 border-primary/40'
          }

          return (
            <div
              key={step.step}
              className={`p-3 rounded-xl border flex flex-col justify-between space-y-1.5 transition-all ${cardBg}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-400">#{step.step}</span>
                {statusBadge}
              </div>
              <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                {step.label}
              </div>
              {step.detail && (
                <div className="text-[10px] text-state-danger line-clamp-1">
                  {step.detail}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
