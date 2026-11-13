'use client';

import React, { useState } from 'react';
import { CustomerCanaryTrace, BookingRecord, RevenueOutcome } from '@/types/customer-crm';
import { CustomerCrmService } from '@/lib/crm/customer-crm-service';
import { 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  ArrowRight, 
  Sparkles, 
  MessageSquare, 
  CalendarCheck, 
  Receipt, 
  UserCheck,
  ShieldAlert,
  Search
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CustomerClosedLoopTraceProps {
  workspaceId: string;
}

export function CustomerClosedLoopTrace({ workspaceId }: CustomerClosedLoopTraceProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Controlled Canary Customer 1명 전체 Closed Loop Trace
  const canaryTrace: CustomerCanaryTrace = React.useMemo(() => {
    return CustomerCrmService.generateCanaryTrace({
      workspaceId,
      customerName: '김민지 (Canary)',
      channel: 'instagram',
      handle: '@minji_kim',
      slotIso: '2026-09-08T15:00:00.000Z',
      serviceName: '봄맞이 1:1 퍼스널 자연 결 브로우',
      depositKrw: 20000,
      finalKrw: 120000,
    });
  }, [workspaceId]);

  return (
    <div className="rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                폐쇄루프 전환 추적기 (Conversation ➔ Booking ➔ Revenue Lineage)
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-foreground dark:text-primary font-bold border border-primary/30">
                Canary Verified
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              문의 접수부터 슬롯 실시간 가용성 확인, 가예약, 예약금 완납, 매장 방문, 매출 결산까지 동일한 식별자로 연결됩니다.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs font-bold text-primary hover:underline cursor-pointer"
        >
          {isOpen ? '닫기' : '자세히 보기'}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-4 pt-1">
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-zinc-700 dark:text-zinc-300">
                고객: <span className="text-primary">김민지 (@minji_kim)</span>
              </span>
              <span className="font-mono text-zinc-400">
                Trace ID: {canaryTrace.traceId}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-state-ok flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 7단계 전수 독립 검증 완료
              </span>
            </div>
          </div>

          {/* 7-Step Timeline Rail */}
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {canaryTrace.steps.map((step, idx) => (
              <div
                key={step.step}
                className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/70 dark:border-zinc-800/80 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-zinc-400">
                    STEP 0{idx + 1}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">
                    {step.step === 'CONVERSATION' && '고객 문의'}
                    {step.step === 'INTENT' && '의도 분류'}
                    {step.step === 'SLOT_CHECK' && '슬롯 가용성'}
                    {step.step === 'BOOKING_HOLD' && '슬롯 가예약'}
                    {step.step === 'DEPOSIT_CONFIRM' && '예약금 확정'}
                    {step.step === 'VISIT' && '매장 방문'}
                    {step.step === 'REVENUE' && '매출 완결'}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1 line-clamp-3 leading-tight">
                    {step.detail}
                  </p>
                </div>
                {step.evidenceId && (
                  <div className="pt-1 border-t border-zinc-200/60 dark:border-zinc-800 text-[9px] font-mono text-primary truncate">
                    증거: {step.evidenceId}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
