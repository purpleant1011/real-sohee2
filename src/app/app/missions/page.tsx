"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Rocket,
  Plus,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  Layers,
  Archive,
  Megaphone,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { SoheeButton } from "@/components/v087/ui/SoheeButton";
import { TrialJourneyTracker } from "@/components/v089/trial-journey-tracker";
import { useWorkspaceId } from "@/hooks/use-workspace-context";
import {
  type CanonicalMissionDTO,
  getHonestExecutionProgressText,
  getObservationDisplayBadge,
} from "@/lib/mission-os/mission-read-model";

type LoadStatus = "loading" | "ready" | "error" | "empty";

export default function MissionsListPage() {
  const router = useRouter();
  const workspaceId = useWorkspaceId();

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [missions, setMissions] = useState<CanonicalMissionDTO[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasPartialErrors, setHasPartialErrors] = useState<boolean>(false);

  const fetchMissions = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    setHasPartialErrors(false);
    try {
      const res = await fetch("/api/missions", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("업무 목록을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      const data = await res.json();
      const items: CanonicalMissionDTO[] = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.canonicalMissions)
        ? data.canonicalMissions
        : [];

      setHasPartialErrors(Boolean(data.hasPartialErrors));
      setMissions(items);
      setStatus(items.length > 0 ? "ready" : "empty");
    } catch (err) {
      console.error("[MissionsListPage] fetch error:", err);
      setErrorMessage((err as Error).message || "업무 목록을 불러오지 못했습니다.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16 font-sans">
      {/* V0.8.9 14-Day Trial Journey Roadmap */}
      <TrialJourneyTracker workspaceId={workspaceId} />

      {/* Top Header - Warm #faf9f7 theme */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[#6D4AFF] text-white shadow-xs shrink-0">
            <Rocket className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-base sm:text-lg font-black text-[#171717] dark:text-white">
              실행안 센터
            </h1>
            <p className="text-xs text-[#666666] dark:text-zinc-400">
              포착된 기회를 바탕으로 수립된 구체적인 마케팅 실행안 및 단계별 진행 상황입니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchMissions}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border border-[#EAE7E3] dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[#555] dark:text-zinc-300 hover:bg-[#FAF9F7] transition-colors min-h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
            aria-label="업무 목록 새로고침"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>새로고침</span>
          </button>

          <SoheeButton
            size="sm"
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => router.push("/app/content")}
            className="min-h-11"
          >
            새 실행안 만들기
          </SoheeButton>
        </div>
      </div>

      {/* Partial Errors Notice if some rows failed conversion */}
      {hasPartialErrors && (
        <div
          role="status"
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>일부 업무 내역을 정리하는 중 통신 지연이 발생하여 확인 가능한 항목만 표시하고 있습니다.</span>
        </div>
      )}

      {/* State Renderings */}
      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="p-12 text-center rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-zinc-800 space-y-3"
        >
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[#6D4AFF] border-t-transparent" />
          <p className="text-sm font-bold text-[#555] dark:text-zinc-300">
            실행안 목록을 안전하게 불러오고 있습니다...
          </p>
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="p-6 rounded-2xl bg-[#FFF5F5] dark:bg-red-950/30 border border-[#FED7D7] dark:border-red-900 space-y-3 text-left"
        >
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>업무 목록을 조회하지 못했습니다.</span>
          </div>
          <p className="text-xs text-red-700 dark:text-red-300">
            {errorMessage || "네트워크 또는 서버 오류가 발생했습니다. 조회가 실패했다고 해서 확인할 일이 없는 것은 아닙니다."}
          </p>
          <button
            type="button"
            onClick={fetchMissions}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors min-h-11 cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      )}

      {status === "empty" && (
        <div
          role="status"
          className="p-12 text-center rounded-2xl bg-white dark:bg-[#141517] border border-dashed border-[#EAE7E3] dark:border-zinc-800 space-y-4"
        >
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#FAF9F7] dark:bg-zinc-900 text-[#6D4AFF] border border-[#EAE7E3] dark:border-zinc-800">
            <Rocket className="w-6 h-6" />
          </span>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[#171717] dark:text-white">
              현재 진행 중인 마케팅 임무가 없습니다
            </h3>
            <p className="text-xs text-[#666] dark:text-zinc-400 max-w-md mx-auto">
              콘텐츠 스튜디오나 대화를 통해 새로운 마케팅 지시를 소희에게 맡겨보세요.
            </p>
          </div>
          <div className="pt-2">
            <SoheeButton
              size="sm"
              variant="primary"
              onClick={() => router.push("/app/content")}
              className="min-h-11"
            >
              새 마케팅 지시 시작하기
            </SoheeButton>
          </div>
        </div>
      )}

      {status === "ready" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {missions.map((mission) => {
            const hasErrors = Array.isArray(mission.errors) && mission.errors.length > 0;
            const progressText = getHonestExecutionProgressText(mission, 'list');
            const obsBadge = getObservationDisplayBadge(mission.observationStatus, mission.observedValue, 'list');

            return (
              <article
                key={mission.missionId}
                className="p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-zinc-800 shadow-xs hover:border-[#6D4AFF]/40 transition-all flex flex-col justify-between space-y-4"
              >
                {/* Header row: Channel & Badge */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#FAF9F7] dark:bg-zinc-900 border border-[#EAE7E3] dark:border-zinc-800 text-[#333] dark:text-zinc-200">
                      {mission.targetChannel || "전체 채널"}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-[#6D4AFF] text-white text-[11px]">
                      {mission.userBadge}
                    </span>
                  </div>

                  {/* Goal (Objective) */}
                  <h3 className="text-base font-black text-[#171717] dark:text-white leading-snug break-words">
                    {mission.goal}
                  </h3>
                </div>

                {/* Dual State Lines (Figma 39:65 Contract Requirement: Distinct Separate Lines) */}
                <div className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-zinc-900/60 border border-[#EAE7E3] dark:border-zinc-800 space-y-2.5 text-xs">
                  {/* Line 1: Execution State */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-[#EAE7E3] dark:border-zinc-800">
                    <span className="font-bold text-[#666] dark:text-zinc-400">
                      진행 상황:
                    </span>
                    <span className="font-semibold text-foreground">
                      {progressText}
                    </span>
                  </div>

                  {/* Line 2: Outcome State */}
                  <div className="flex flex-col gap-1">
                    <span className="font-bold text-[#666] dark:text-zinc-400">
                      성과 확인:
                    </span>
                    <p className="text-[11px] text-[#333] dark:text-zinc-200 leading-relaxed font-medium">
                      {mission.userCopy}
                    </p>
                  </div>

                  {/* Observation Status indicator */}
                  <div className="pt-2 border-t border-[#EAE7E3] dark:border-zinc-800 flex items-center justify-between text-[11px]">
                    <span className="text-[#666] dark:text-zinc-400 font-bold">성과 관측:</span>
                    <span className={`px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${obsBadge.badgeClass}`}>
                      {obsBadge.kind === 'read_failed' || obsBadge.kind === 'unverified_evidence' ? (
                        <AlertTriangle className="w-3 h-3" />
                      ) : obsBadge.kind === 'verified' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : obsBadge.kind === 'pending' ? (
                        <Clock className="w-3 h-3" />
                      ) : null}
                      <span>{obsBadge.label}</span>
                    </span>
                  </div>

                  {/* Next check timestamp if scheduled */}
                  {mission.nextCheckAt && (
                    <div className="text-[10px] text-[#888] dark:text-zinc-400">
                      다음 확인 예정: {new Date(mission.nextCheckAt).toLocaleString("ko-KR")}
                    </div>
                  )}
                </div>

                {/* Honest Errors Callout (errors != empty/0) */}
                {hasErrors && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-1 text-xs"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>확인 필요 사항 ({mission.errors.length}건)</span>
                    </div>
                    <ul className="list-disc list-inside text-[11px] text-amber-700 dark:text-amber-200 space-y-0.5">
                      {mission.errors.map((err, idx) => (
                        <li key={idx} className="break-words">
                          {err}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Footer Controls & Deep Links */}
                <div className="pt-3 border-t border-[#EAE7E3] dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Preserved Deep-Links: /app/content, /app/vault, /app/ads */}
                  <div className="flex items-center gap-2 text-xs">
                    <Link
                      href="/app/content"
                      className="inline-flex items-center gap-1 text-[#6D4AFF] hover:underline min-h-11 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>콘텐츠</span>
                    </Link>
                    <span className="text-zinc-300">·</span>
                    <Link
                      href="/app/vault"
                      className="inline-flex items-center gap-1 text-[#6D4AFF] hover:underline min-h-11 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>보관함</span>
                    </Link>
                    <span className="text-zinc-300">·</span>
                    <Link
                      href="/app/ads"
                      className="inline-flex items-center gap-1 text-[#6D4AFF] hover:underline min-h-11 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
                    >
                      <Megaphone className="w-3.5 h-3.5" />
                      <span>광고/채널</span>
                    </Link>
                  </div>

                  <button
                    type="button"
                    onClick={() => router.push(`/app/missions/${mission.missionId}`)}
                    className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl text-xs font-bold bg-[#6D4AFF] text-white hover:bg-[#5B3EE0] transition-colors min-h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
                  >
                    <span>상세 보기</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
