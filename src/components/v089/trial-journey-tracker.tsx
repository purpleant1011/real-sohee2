"use client";

import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Sparkles,
  TrendingUp,
  Calendar,
  DollarSign,
  Share2,
  ArrowRight,
  ShieldCheck,
  AlertCircle
} from "lucide-react";
import Link from "next/link";
import { TrialMilestone, TrialValueSummary } from "@/lib/trial/trial-journey";

interface TrialJourneyTrackerProps {
  workspaceId: string;
  initialMilestones?: TrialMilestone[];
  initialSummary?: TrialValueSummary;
}

export function TrialJourneyTracker({
  workspaceId,
  initialMilestones = [],
  initialSummary
}: TrialJourneyTrackerProps) {
  const [milestones, setMilestones] = useState<TrialMilestone[]>(initialMilestones);
  const [summary, setSummary] = useState<TrialValueSummary | undefined>(initialSummary);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    initialSummary ? 'ready' : 'loading'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const prevWorkspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    const isWorkspaceChanged = prevWorkspaceIdRef.current !== workspaceId;
    prevWorkspaceIdRef.current = workspaceId;

    if (!isWorkspaceChanged && initialSummary) {
      setSummary(initialSummary);
      setMilestones(initialMilestones);
      setStatus('ready');
      return;
    }

    const currentReqId = ++reqIdRef.current;
    setStatus('loading');
    setErrorMessage(null);

    fetch(`/api/workspaces/${workspaceId}/trial-journey`)
      .then(async (res) => {
        if (reqIdRef.current !== currentReqId) return;
        if (!res.ok) {
          throw new Error('가치 요약을 불러오지 못했습니다.');
        }
        const data = await res.json();
        if (reqIdRef.current !== currentReqId) return;
        if (data.success && data.summary) {
          setMilestones(data.milestones || []);
          setSummary(data.summary);
          setStatus('ready');
        } else {
          throw new Error(data.error || '가치 요약을 불러오지 못했습니다.');
        }
      })
      .catch((err) => {
        if (reqIdRef.current !== currentReqId) return;
        setStatus('error');
        setErrorMessage(err.message || '가치 요약을 불러오지 못했습니다.');
      });
  }, [workspaceId, initialSummary]);

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="p-6 rounded-3xl bg-red-950/30 border border-red-800/40 text-red-200 flex items-start gap-3"
      >
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-red-300">트라이얼 로드맵 상태</h3>
          <p className="text-xs text-red-400">
            {errorMessage || '가치 요약을 불러오지 못했습니다.'}
          </p>
        </div>
      </div>
    );
  }

  const completedCount = milestones.filter(m => m.isCompleted).length;
  const progressPercent = Math.round((completedCount / (milestones.length || 5)) * 100);

  return (
    <div className="space-y-6 font-sans">
      {/* 14일 가치 요약 배너 */}
      <div className="p-6 rounded-3xl bg-gradient-to-br from-state-wait/40 via-zinc-900/60 to-primary/40 border border-state-wait/20 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-state-wait/20 text-state-wait border border-state-wait/30">
                14일 AI 마케팅 사원 트라이얼 로드맵
              </span>
              {summary ? (
                <span className="text-xs font-mono text-zinc-400">
                  Day {summary.daysActive} / 14 (남은 기간 {summary.daysRemaining}일)
                </span>
              ) : (
                <span className="text-xs font-mono text-zinc-400">
                  로드맵 상태 계산 대기
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              소희와 함께 만든 실제 마케팅 가치와 성장 기록
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl">
              14일간 소희는 단순 생성기가 아닌 전담 마케팅 사원으로서 매장의 브랜드를 학습하고 자율 캠페인을 실행합니다.
            </p>
            {summary?.provenance?.laborBasisDescription && (
              <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 pt-1">
                <Sparkles className="w-3.5 h-3.5 text-state-wait shrink-0" />
                <span>산정 근거: {summary.provenance.laborBasisDescription}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="px-5 py-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center">
              <span className="text-[11px] text-zinc-400 block">절감한 마케팅 비용</span>
              <span className="text-lg font-black text-state-ok font-mono">
                {summary !== undefined ? (
                  `₩ ${summary.estimatedLaborSavingsWon.toLocaleString()}`
                ) : (
                  <span className="text-zinc-500 text-sm font-normal">확인 중</span>
                )}
              </span>
            </div>
            <Link
              href={`/app/account/billing`}
              className="px-5 py-3 rounded-2xl bg-state-wait hover:bg-state-wait/90 text-state-wait-soft font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-state-wait/30 transition"
            >
              <span>정식 플랜 전환 가이드</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 진행률 바 */}
        <div className="mt-6 pt-5 border-t border-zinc-800/80 space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>여정 달성률: {completedCount} / {milestones.length || 5} 단계 완료</span>
            <span className="font-bold text-state-wait">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-state-wait to-state-ok/40 transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 5대 마일스톤 타임라인 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {milestones.map((m, idx) => {
          const isDone = m.isCompleted;
          const isNext = !isDone && (idx === 0 || milestones[idx - 1]?.isCompleted);

          return (
            <div
              key={m.id || idx}
              className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
                isDone
                  ? 'bg-state-ok/20 border-state-ok/30 text-zinc-200'
                  : isNext
                  ? 'bg-state-wait/20 border-state-wait/40 text-state-wait shadow-md'
                  : 'bg-zinc-900/30 border-zinc-800/60 text-zinc-500'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    isDone
                      ? 'bg-state-ok/20 text-state-ok'
                      : isNext
                      ? 'bg-state-wait/20 text-state-wait'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    Day {m.dayStage}
                  </span>
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-state-ok" />
                  ) : isNext ? (
                    <Clock className="w-4 h-4 text-state-wait animate-pulse" />
                  ) : (
                    <Circle className="w-4 h-4 text-zinc-600" />
                  )}
                </div>
                <h4 className="text-sm font-bold leading-snug">{m.title}</h4>
                <p className="text-[11px] leading-relaxed text-zinc-400">{m.description}</p>
              </div>

              <div>
                {isDone ? (
                  <span className="text-[11px] font-mono text-state-ok flex items-center gap-1 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" /> 완료 검증됨
                  </span>
                ) : isNext ? (
                  <Link
                    href={
                      m.category === 'CHANNEL_SETUP'
                        ? '/app/channels'
                        : m.category === 'AUTONOMOUS_RUN'
                        ? '/app/campaigns'
                        : m.category === 'COMPETITOR_INSIGHT'
                        ? '/app/reports'
                        : '/app/account/billing'
                    }
                    className="w-full py-1.5 rounded-xl bg-state-wait hover:bg-state-wait/90 text-state-wait-soft font-bold text-[11px] text-center block transition shadow-sm"
                  >
                    지금 실행하기
                  </Link>
                ) : (
                  <span className="text-[11px] text-zinc-600">진행 대기</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
