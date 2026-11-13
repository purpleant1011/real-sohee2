'use client';

import React, { useState } from 'react';
import { AutonomyEnvelopePolicy } from '@/types/my-sohee-control';
import { MySoheeService } from '@/lib/my-sohee/my-sohee-service';
import { 
  ShieldCheck, 
  Lock, 
  Unlock, 
  Coins, 
  Percent, 
  AlertTriangle, 
  Save, 
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AutonomyEnvelopeCardProps {
  workspaceId: string;
}

export function AutonomyEnvelopeCard({ workspaceId }: AutonomyEnvelopeCardProps) {
  const [policy, setPolicy] = useState<AutonomyEnvelopePolicy>({
    policyId: 'policy-default',
    workspaceId,
    version: 1,
    maxDailyAdSpendKrw: 30000,
    maxDiscountPercent: 15,
    allowedChannels: ['INSTAGRAM', 'NAVER_BLOG', 'DAANGN'],
    forbiddenWords: ['완치', '100% 보장', '부작용 전혀 없음'],
    approvalConditions: {
      minSpendRequiringApproval: 20000,
      requireApprovalForNewCampaign: true,
      requireApprovalForRefundProposal: true,
    },
    updatedAt: new Date().toISOString(),
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleUpdateLimit = (amount: number) => {
    const updated = MySoheeService.saveAutonomyEnvelope(policy, {
      maxDailyAdSpendKrw: amount,
    });
    setPolicy(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleUpdateDiscount = (discount: number) => {
    const updated = MySoheeService.saveAutonomyEnvelope(policy, {
      maxDiscountPercent: discount,
    });
    setPolicy(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                혼자 해도 되는 범위
              </h2>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              소희가 사장님께 묻지 않고 해도 되는 광고비와 할인의 한도예요.
            </p>
          </div>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 text-xs font-bold text-state-ok">
            <CheckCircle2 className="w-4 h-4" /> 정책 동기화 완료
          </div>
        )}
      </div>

      {/* Grid Policies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Ad Spend Limit */}
        <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-primary" /> 일일 광고비 자율 한도
            </span>
            <span className="font-mono font-extrabold text-xs text-primary">
              ₩{policy.maxDailyAdSpendKrw.toLocaleString()} / 일
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {[10000, 30000, 50000].map((amt) => (
              <button
                key={amt}
                onClick={() => handleUpdateLimit(amt)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                  policy.maxDailyAdSpendKrw === amt
                    ? "bg-primary text-white border-primary shadow-2xs"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                )}
              >
                ₩{amt.toLocaleString()}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400">
            이 한도를 초과하는 광고 캠페인 집행은 즉시 소희 Dock에서 사장님 승인을 요구합니다.
          </p>
        </div>

        {/* Max Discount Rate */}
        <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5 text-state-ok" /> 고객 문의 시 최대 할인 허용률
            </span>
            <span className="font-mono font-extrabold text-xs text-state-ok">
              최대 {policy.maxDiscountPercent}%
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {[10, 15, 20].map((disc) => (
              <button
                key={disc}
                onClick={() => handleUpdateDiscount(disc)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                  policy.maxDiscountPercent === disc
                    ? "bg-state-ok text-white border-state-ok shadow-2xs"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                )}
              >
                {disc}% 제한
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400">
            당근/인스타 DM에서 유휴 슬롯 마감을 위해 소희가 제시할 수 있는 최대 할인 폭입니다.
          </p>
        </div>
      </div>

      {/* Safety Conditions checklist */}
      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800 text-xs space-y-2">
        <div className="font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-zinc-500" /> 꼭 물어볼 조건
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" /> 신규 유료 광고 캠페인 생성 시
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" /> 고객 환불 및 서비스 불만 응대 시
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" /> 의료법 표시광고법 금칙어 감지 시
          </div>
        </div>
      </div>
    </div>
  );
}
