'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { OwnerException } from '@/features/agent-dock/types';

interface OwnerExceptionCardProps {
  exception: OwnerException;
  onApproveProposal?: (proposalId: string) => Promise<void> | void;
  onRejectProposal?: (proposalId: string) => void;
  onDismiss?: (exceptionId: string) => void;
}

export function OwnerExceptionCard({
  exception,
  onApproveProposal,
  onRejectProposal,
  onDismiss,
}: OwnerExceptionCardProps) {
  const isCritical = exception.severity === 'CRITICAL';

  return (
    <div
      data-testid="owner-exception-card"
      className={`p-3.5 rounded-xl border transition-all ${
        isCritical
          ? 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60'
          : 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {isCritical ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <span
            className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded ${
              isCritical
                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
            }`}
          >
            사장님 확인 필요
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {exception.category}
        </span>
      </div>

      <h4 className="text-xs font-bold text-foreground mb-1 leading-snug">
        {exception.title}
      </h4>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {exception.description}
      </p>

      {exception.proposal && exception.proposal.status === 'PENDING' && (
        <div className="p-2.5 rounded-lg bg-card/80 border border-border/80 text-xs mb-3 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between font-bold text-foreground">
            <span>제안: {exception.proposal.title}</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
              PROPOSAL
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {exception.proposal.description}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onApproveProposal?.(exception.proposal!.id)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-2xs cursor-pointer transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>답변하고 중앙 설정에 반영</span>
            </button>
            <button
              type="button"
              onClick={() => onRejectProposal?.(exception.proposal!.id)}
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground font-semibold text-xs cursor-pointer transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span className="sr-only">제안 거절</span>
            </button>
          </div>
        </div>
      )}

      {exception.proposal && exception.proposal.status === 'ACCEPTED' && (
        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between font-bold">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            중앙 설정 및 규칙에 반영 완료됨
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(exception.id)}
              className="text-[10px] text-muted-foreground underline cursor-pointer"
            >
              닫기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
