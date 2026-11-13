"use client";

import React, { useState, useEffect, useRef } from "react";
import { Clock, Eye, AlertTriangle, ShieldCheck, Undo2 } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { SoheeButton } from "../ui/SoheeButton";
import { RiskTierBadge } from "../common/RiskTierBadge";
import type { RiskTier } from "@/lib/read-models/types";

export interface ApprovalCardProps {
  id: string;
  actionType: string;
  riskTier: RiskTier;
  title: string;
  why: string;
  targetWho?: string;
  previewContent: string;
  expectedImpact?: string;
  cost?: string;
  deadline?: string;
  channel?: string;
  onApprove: (id: string) => Promise<void> | void;
  onReject: (id: string, reason?: string) => Promise<void> | void;
  className?: string;
}

export function ApprovalCard({
  id,
  riskTier,
  title,
  why,
  targetWho,
  previewContent,
  expectedImpact,
  cost = "무료",
  deadline,
  channel,
  onApprove,
  onReject,
  className = "",
}: ApprovalCardProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGracePeriod, setIsGracePeriod] = useState(false);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(5);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExecuted, setIsExecuted] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const [isCriticalConfirmOpen, setIsCriticalConfirmOpen] = useState(false);
  const [criticalInput, setCriticalInput] = useState("");

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isGracePeriod) return;

    if (graceSecondsLeft > 0) {
      timerRef.current = setTimeout(() => {
        setGraceSecondsLeft((prev) => prev - 1);
      }, 1000);
    } else {
      const executeTimer = setTimeout(() => {
        setIsGracePeriod(false);
        setIsProcessing(true);
        Promise.resolve(onApprove(id))
          .then(() => {
            setIsProcessing(false);
            setIsExecuted(true);
          })
          .catch(() => {
            setIsProcessing(false);
            setIsGracePeriod(false);
          });
      }, 0);
      return () => clearTimeout(executeTimer);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isGracePeriod, graceSecondsLeft, id, onApprove]);

  const handleApproveClick = () => {
    if (riskTier === "critical") {
      setIsCriticalConfirmOpen(true);
      return;
    }

    if (riskTier === "medium" || riskTier === "low") {
      setIsGracePeriod(true);
      setGraceSecondsLeft(5);
      return;
    }

    setIsProcessing(true);
    Promise.resolve(onApprove(id))
      .then(() => {
        setIsProcessing(false);
        setIsExecuted(true);
      })
      .catch(() => {
        setIsProcessing(false);
      });
  };

  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsGracePeriod(false);
    setGraceSecondsLeft(5);
  };

  const handleRejectClick = () => {
    setIsRejected(true);
    Promise.resolve(onReject(id));
  };

  const handleCriticalConfirmSubmit = () => {
    if (criticalInput.trim().length === 0) return;
    setIsCriticalConfirmOpen(false);
    setIsProcessing(true);
    Promise.resolve(onApprove(id))
      .then(() => {
        setIsProcessing(false);
        setIsExecuted(true);
      })
      .catch(() => {
        setIsProcessing(false);
      });
  };

  if (isExecuted) {
    return (
      <SoheeCard variant="default" className="p-4 bg-state-ok/50 border-state-ok/30 text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-black text-state-ok">
          <ShieldCheck className="w-4 h-4" />
          승인이 완료되어 실행 및 게시 확인 단계로 넘어갔습니다.
        </div>
      </SoheeCard>
    );
  }

  if (isRejected) {
    return (
      <SoheeCard variant="default" className="p-4 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-center space-y-2">
        <div className="text-xs font-bold text-zinc-500">이 실행안은 사장님에 의해 반려(보류)되었습니다.</div>
      </SoheeCard>
    );
  }

  return (
    <SoheeCard
      variant="elevated"
      className={`space-y-4 hover:border-[#6D4AFF]/40 transition-all ${
        isGracePeriod ? "ring-2 ring-[#F59E0B] border-[#F59E0B]" : ""
      } ${className}`}
    >
      {/* Grace Period Overlay Banner */}
      {isGracePeriod && (
        <div className="p-3 rounded-xl bg-[#FEF7EC] dark:bg-state-warn/60 border border-[#F59E0B]/40 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#F59E0B]" />
            <span className="text-xs font-extrabold text-[#92400E] dark:text-state-warn">
              <strong className="text-[#F59E0B]">{graceSecondsLeft}초</strong> 후 자동 승인 및 실행됩니다.
            </span>
          </div>
          <button
            onClick={handleUndo}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-black transition-all shadow-xs"
          >
            <Undo2 className="w-3.5 h-3.5" />
            실행 취소 (Undo)
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <RiskTierBadge tier={riskTier} />
          {channel && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-[#FAF9F7] dark:bg-zinc-800 text-[#666666] dark:text-zinc-300 border border-[#EAE7E3] dark:border-zinc-700">
              {channel}
            </span>
          )}
          {deadline && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#F59E0B]">
              <Clock className="w-3 h-3" />
              {deadline}
            </span>
          )}
        </div>

        <span className="text-[10px] font-bold text-[#8C8A87]">ID: {id.slice(0, 8)}</span>
      </div>

      {/* Title & Why */}
      <div className="space-y-1.5">
        <h3 className="text-base font-black text-[#171717] dark:text-white leading-snug">{title}</h3>
        <p className="text-xs text-[#555555] dark:text-zinc-300 font-medium">
          <strong className="text-[#6D4AFF] dark:text-[#8B6BFF] mr-1">발행/실행 목적:</strong>
          {why}
        </p>
      </div>

      {/* Impact & Target */}
      <div className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-zinc-900/70 border border-[#EAE7E3] dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {targetWho && (
          <div>
            <span className="block text-[10px] font-bold text-[#8C8A87]">발송/적용 대상</span>
            <span className="font-extrabold text-[#171717] dark:text-white">{targetWho}</span>
          </div>
        )}
        {expectedImpact && (
          <div>
            <span className="block text-[10px] font-bold text-[#8C8A87]">기대 효과</span>
            <span className="font-extrabold text-[#10B981]">{expectedImpact}</span>
          </div>
        )}
      </div>

      {/* Preview Snippet */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#8C8A87]">원고/메시지 미리보기</span>
          <button
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
            className="text-[11px] font-extrabold text-[#6D4AFF] dark:text-[#8B6BFF] hover:underline flex items-center gap-1"
          >
            <Eye className="w-3 h-3" />
            {isPreviewOpen ? "간략히 보기" : "전체 원고 펼치기"}
          </button>
        </div>

        <div
          className={`p-3 rounded-xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-zinc-800 text-xs text-[#333333] dark:text-zinc-200 leading-relaxed font-sans ${
            isPreviewOpen ? "whitespace-pre-wrap" : "line-clamp-2"
          }`}
        >
          {previewContent}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-[#EAE7E3] dark:border-zinc-800">
        <span className="text-xs font-bold text-[#666666] dark:text-zinc-400">
          소요 비용: <strong className="text-[#171717] dark:text-white">{cost}</strong>
        </span>

        <div className="flex items-center gap-2">
          <SoheeButton
            size="sm"
            variant="ghost"
            onClick={handleRejectClick}
            disabled={isGracePeriod || isProcessing}
          >
            반려 / 보류
          </SoheeButton>
          <SoheeButton
            size="sm"
            variant="primary"
            onClick={handleApproveClick}
            disabled={isGracePeriod || isProcessing}
          >
            {isProcessing ? "처리 중..." : "확인 및 승인"}
          </SoheeButton>
        </div>
      </div>

      {/* Critical Modal */}
      {isCriticalConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1C1E22] p-6 rounded-2xl max-w-md w-full border border-state-danger/30 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-state-danger">
              <AlertTriangle className="w-6 h-6" />
              <h4 className="text-base font-black">고위험 실행 최종 승인</h4>
            </div>
            <p className="text-xs text-[#555555] dark:text-zinc-300">
              본 작업은 대규모 고객 메시지 발송 또는 예산 집행이 포함되어 있습니다. 계속 진행하시려면 확인을 위해 <strong>{title.slice(0, 10)}</strong>을 아래에 입력해 주세요.
            </p>
            <input
              type="text"
              value={criticalInput}
              onChange={(e) => setCriticalInput(e.target.value)}
              placeholder="위 문구를 입력하세요"
              className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
            />
            <div className="flex justify-end gap-2 pt-2">
              <SoheeButton size="sm" variant="ghost" onClick={() => setIsCriticalConfirmOpen(false)}>
                취소
              </SoheeButton>
              <SoheeButton size="sm" variant="primary" onClick={handleCriticalConfirmSubmit}>
                확인 및 실행
              </SoheeButton>
            </div>
          </div>
        </div>
      )}
    </SoheeCard>
  );
}
