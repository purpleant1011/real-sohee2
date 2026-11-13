"use client";

import React, { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Archive,
  Megaphone,
  ShieldAlert,
  ShieldCheck,
  Info,
  PauseCircle,
  PlayCircle,
  Send,
} from "lucide-react";
import { useWorkspaceId } from "@/hooks/use-workspace-context";
import { FirstPostResume } from "@/features/mobile-firstpost/first-post-resume";
import {
  type CanonicalMissionDTO,
  getHonestExecutionProgressText,
  getObservationDisplayBadge,
} from "@/lib/mission-os/mission-read-model";
import { MissionPlanDiffRail } from "@/components/missions/mission-plan-diff-rail";
import { MissionConversationContinuation } from "@/components/missions/mission-conversation-continuation";
import { MissionPlanDiffCard } from "@/components/missions/mission-plan-diff-card";
import { MissionRehearsalCard } from "@/components/missions/mission-rehearsal-card";
import type { PlanDiff } from "@/lib/mission-os/mission-plan-diff";
import type { RehearsalResult } from "@/lib/mission-os/mission-rehearsal";

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

type LoadState = "loading" | "ready" | "error";

export default function MissionDetailPage({ params }: PageProps) {
  const workspaceId = useWorkspaceId();
  const searchParams = useSearchParams();
  const planPrompt = searchParams?.get("planPrompt") || "";
  const resolvedParams = typeof (params as any)?.then === "function" ? use(params as Promise<{ id: string }>) : (params as { id: string });
  const id = resolvedParams.id;
  return <MissionDetailContent key={`${workspaceId}:${id}`} id={id} workspaceId={workspaceId} planPrompt={planPrompt} />;
}

function MissionDetailContent({ id, workspaceId, planPrompt }: { id: string; workspaceId: string | null; planPrompt: string }) {
  const router = useRouter();
  const adjustmentInput = useRef<HTMLInputElement>(null);
  const [conversationHref, setConversationHref] = useState<string | null>(null);
  const mounted = useRef(false);
  const readGeneration = useRef(0);
  const submitLock = useRef(false);
  const handledPrompts = useRef(new Set<string>());
  const approvalRequest = useRef<{ binding: string; key: string } | null>(null);
  const [contractApproval, setContractApproval] = useState<{ payload_hash: string; review_lines: string[] } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [canonicalDto, setCanonicalDto] = useState<CanonicalMissionDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<number>(1);
  const [activePlanDiff, setActivePlanDiff] = useState<PlanDiff | null>(null);
  const [activeRehearsal, setActiveRehearsal] = useState<RehearsalResult | null>(null);
  const [inputText, setInputText] = useState(planPrompt);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchMissionDetail = useCallback(async () => {
    if (!mounted.current) return;
    const generation = ++readGeneration.current;
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("로그인 인증이 만료되었습니다. 다시 로그인해 주세요.");
        }
        if (res.status === 404) {
          throw new Error("해당 마케팅 업무를 찾을 수 없거나 권한이 없습니다.");
        }
        throw new Error("업무 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      const data = await res.json();
      if (!mounted.current || generation !== readGeneration.current) return;
      if (!data.canonicalDto || data.canonicalDto.missionId !== id || data.canonicalDto.workspaceId !== workspaceId) {
        throw new Error("업무 정보를 안전하게 수신하지 못했습니다.");
      }
      setCanonicalDto(data.canonicalDto);
      setConversationHref(typeof data.conversation_href === "string" && /^\/app\/conversations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.conversation_href) ? data.conversation_href : null);
      const review = data.contract_approval;
      setContractApproval(review && /^[a-f0-9]{64}$/.test(review.payload_hash) &&
        Array.isArray(review.review_lines) && review.review_lines.every((line: unknown) => typeof line === "string") ? review : null);
      if (typeof data.snapshot_version === "number") {
        setSnapshotVersion(data.snapshot_version);
      }
      setLoadState("ready");
    } catch (err) {
      if (!mounted.current || generation !== readGeneration.current) return;
      setContractApproval(null);
      console.error("[MissionDetailPage] fetch error:", err);
      setErrorMessage((err as Error).message || "업무 정보를 불러오지 못했습니다.");
      setLoadState("error");
    }
  }, [id, workspaceId]);

  useEffect(() => {
    mounted.current = true;
    void fetchMissionDetail();
    return () => { mounted.current = false; readGeneration.current++; };
  }, [fetchMissionDetail]);

  // Handle Conversational Intent -> PlanDiff or Pause Command
  const handleSendIntent = useCallback(async (overrideText?: string, calculationOnly = false) => {
    const textToSend = (overrideText ?? inputText).trim();
    if (!textToSend || submitLock.current || !mounted.current) return;

    submitLock.current = true;
    setIsSubmitting(true);
    setActionNotice(null);

    // 1. Pause Intent check
    if (!calculationOnly && /(?:그만해|멈춰|중지|일시정지|pause|stop)/i.test(textToSend)) {
      try {
        const res = await fetch(`/api/missions/${encodeURIComponent(id)}/pause`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedSnapshotVersion: snapshotVersion }),
        });
        const data = await res.json();
        if (!mounted.current) return;
        if (!res.ok) {
          setActionNotice(data.error || "일시정지 요청이 처리되지 않았습니다.");
        } else {
          setActionNotice("업무가 일시정지되었습니다. 이미 제출된 요청은 readback으로 확인 중입니다.");
          setInputText("");
          await fetchMissionDetail();
        }
      } catch {
        setActionNotice("일시정지 요청 중 네트워크 오류가 발생했습니다.");
      } finally {
        submitLock.current = false;
        if (mounted.current) setIsSubmitting(false);
      }
      return;
    }

    // 2. PlanDiff calculation
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}/plan-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentText: textToSend,
          expectedSnapshotVersion: snapshotVersion,
        }),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setActionNotice(data.error || "계획 변경 계산에 실패했습니다.");
      } else if (data.is_ambiguous) {
        setActionNotice(data.clarification_prompt || "어떤 부분을 변경할지 더 자세히 알려주세요. (확인 전에는 변경되지 않아요)");
      } else if (data.plan_diff) {
        setActivePlanDiff(data.plan_diff);
        setActionNotice("새로운 변경 계획이 작성되었습니다. 검토 후 승인해 주세요.");
        setInputText("");
      }
    } catch {
      setActionNotice("계획 변경 요청 중 일시적인 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  }, [id, inputText, snapshotVersion, fetchMissionDetail]);

  useEffect(() => {
    const prompt = planPrompt.trim();
    if (!prompt || loadState !== "ready" || !canonicalDto || submitLock.current || handledPrompts.current.has(prompt)) return;
    handledPrompts.current.add(prompt);
    // Deep links may calculate a proposal, never approve, pause or execute a mission.
    void handleSendIntent(prompt, true);
  }, [planPrompt, loadState, canonicalDto, handleSendIntent]);

  // Handle PlanDiff Application -> Mutates Contract to NEEDS_DECISION
  const handleApplyPlanDiff = async () => {
    if (!activePlanDiff || submitLock.current || !mounted.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}/apply-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planDiff: activePlanDiff,
          expectedSnapshotVersion: snapshotVersion,
        }),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setActionNotice(data.error || "계획 변경안 적용에 실패했습니다. 최신 내용을 다시 확인해 주세요.");
      } else {
        setActionNotice("계획 변경안이 계약에 안전하게 적용되었습니다. 실제 실행을 위해 아래에서 최종 승인을 진행해 주세요.");
        setActivePlanDiff(null);
        await fetchMissionDetail();
      }
    } catch {
      setActionNotice("계획 변경 적용 중 네트워크 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  // Handle Explicit Contract Execution Approval -> Transitions to READY
  const handleApproveContract = async () => {
    if (submitLock.current || !mounted.current || !contractApproval || canonicalDto?.executionState !== "NEEDS_DECISION") return;
    const binding = `${snapshotVersion}:${contractApproval.payload_hash}`;
    if (approvalRequest.current?.binding !== binding) {
      approvalRequest.current = { binding, key: crypto.randomUUID() };
    }
    const approvalBody = { expectedSnapshotVersion: snapshotVersion, contractPayloadHash: contractApproval.payload_hash, idempotencyKey: approvalRequest.current.key };
    submitLock.current = true;
    setIsSubmitting(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approvalBody),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setActionNotice(data.error || "업무 실행 승인에 실패했습니다.");
      } else {
        setActionNotice(data.execution_state === "READY" ? "업무 계약이 승인되어 실행 준비 상태가 되었습니다." : "승인 기록을 확인했습니다. 현재 업무 상태를 다시 확인해 주세요.");
        await fetchMissionDetail();
      }
    } catch {
      setActionNotice("업무 실행 승인 중 네트워크 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  // Handle Preview Rehearsal Run
  const handleRunRehearsal = async () => {
    if (submitLock.current || !mounted.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}/rehearsal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSnapshotVersion: snapshotVersion }),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setActionNotice(data.error || "리허설 실행에 실패했습니다.");
      } else {
        setActiveRehearsal(data.rehearsal);
        if (typeof data.snapshot_version === "number") {
          setSnapshotVersion(data.snapshot_version);
        }
        setActionNotice("리허설이 완료되었습니다 (외부 발행 0건, 운영 KPI 격리 보장).");
        await fetchMissionDetail();
      }
    } catch {
      setActionNotice("리허설 실행 중 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  // Handle Rehearsal Live Promotion
  const handlePromoteToLive = async () => {
    if (submitLock.current || !mounted.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(id)}/rehearsal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSnapshotVersion: snapshotVersion }),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setActionNotice(data.error || "실서비스 전환 사전 검증에 실패했습니다.");
      } else {
        setActionNotice("실서비스 실행 준비가 완료되었습니다.");
        setActiveRehearsal(null);
        await fetchMissionDetail();
      }
    } catch {
      setActionNotice("실서비스 전환 중 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  const handleOpenMissionChat = () => {
    if (conversationHref) {
      router.push(conversationHref);
      return;
    }
    setActionNotice("연결된 대화를 찾지 못했어요. 이 화면에서 해당 업무를 이어서 조정할 수 있어요.");
    adjustmentInput.current?.focus();
  };

  return (
    <FirstPostResume missionId={id} workspaceId={workspaceId ?? undefined}>
      <div className="space-y-6 max-w-5xl mx-auto pb-16 font-sans">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-card border border-border shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/app/missions")}
              className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer min-h-11 min-w-11 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AFF]"
              aria-label="목록으로 돌아가기"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-primary px-2.5 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                  마케팅 업무 안내
                </span>
                {canonicalDto && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                    채널: {canonicalDto.targetChannel || "전체 채널"}
                  </span>
                )}
              </div>
              <h1 className="text-lg sm:text-xl font-black text-foreground">
                {canonicalDto ? canonicalDto.goal : "업무 상세를 불러오고 있습니다..."}
              </h1>
            </div>
          </div>

          {/* Preserved Deep-Links Toolbar */}
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/app/content"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted transition-colors min-h-11"
            >
              <Layers className="w-3.5 h-3.5 text-[#6D4AFF]" />
              <span>콘텐츠</span>
            </Link>
            <Link
              href="/app/vault"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted transition-colors min-h-11"
            >
              <Archive className="w-3.5 h-3.5 text-[#6D4AFF]" />
              <span>보관함</span>
            </Link>
            <Link
              href="/app/ads"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-muted transition-colors min-h-11"
            >
              <Megaphone className="w-3.5 h-3.5 text-[#6D4AFF]" />
              <span>광고/채널</span>
            </Link>
          </div>
        </div>

        {/* Loading State */}
        {loadState === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="p-12 text-center rounded-3xl bg-card border border-border space-y-3"
          >
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[#6D4AFF] border-t-transparent" />
            <p className="text-sm font-bold text-muted-foreground">
              업무 진행 상태를 확인하고 있습니다...
            </p>
          </div>
        )}

        {/* Error State */}
        {loadState === "error" && (
          <div
            role="alert"
            className="p-6 rounded-3xl bg-[#FFF5F5] dark:bg-red-950/30 border border-[#FED7D7] dark:border-red-900 space-y-3 text-left"
          >
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>업무 상세를 불러오지 못했습니다.</span>
            </div>
            <p className="text-xs text-red-700 dark:text-red-300">
              {errorMessage || "일시적인 오류가 발생했습니다."}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={fetchMissionDetail}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors min-h-11 cursor-pointer"
              >
                다시 시도
              </button>
              <button
                type="button"
                onClick={() => router.push("/app/missions")}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/40 transition-colors min-h-11 cursor-pointer"
              >
                목록으로 돌아가기
              </button>
            </div>
          </div>
        )}

        {/* Ready State */}
        {loadState === "ready" && canonicalDto && (
          <>
            {/* Action Notification Banner */}
            {actionNotice && (
              <div
                role="status"
                aria-live="polite"
                className="p-4 rounded-2xl bg-primary/10 border border-primary/20 text-xs font-bold text-primary flex items-center justify-between gap-2"
              >
                <span>{actionNotice}</span>
                <button
                  type="button"
                  onClick={() => setActionNotice(null)}
                  className="text-primary hover:underline text-[11px] cursor-pointer"
                >
                  닫기
                </button>
              </div>
            )}

            {/* Layout Grid: Left Details & Right Execution Rail (Figma D11 & M20) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Mission Status & Active Cards */}
              <div className="lg:col-span-2 space-y-6">
                {/* 🌟 1. Dual State Card: Execution vs Outcome on Separate Lines (No raw English codes) */}
                <section
                  aria-label="업무 진행 상태 안내"
                  className="p-6 rounded-3xl bg-card border border-border shadow-xs space-y-5"
                >
                  {/* Execution Line */}
                  <div className="space-y-1.5 pb-4 border-b border-border">
                    <span className="text-xs font-bold text-muted-foreground">
                      실행 진행 상황
                    </span>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="px-3 py-1 rounded-lg bg-[#6D4AFF] text-white text-xs font-bold">
                        {canonicalDto.userBadge}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {getHonestExecutionProgressText(canonicalDto, 'detail')}
                      </span>
                    </div>
                  </div>

                  {/* Outcome Line */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-muted-foreground">
                      성과 확인 내용
                    </span>
                    <div className="p-3.5 rounded-2xl bg-muted/50 border border-border text-xs leading-relaxed font-medium text-foreground">
                      {canonicalDto.userCopy}
                    </div>
                  </div>

                  {/* Observation Status */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-muted-foreground">성과 관측:</span>
                      {(() => {
                        const badge = getObservationDisplayBadge(
                          canonicalDto.observationStatus,
                          canonicalDto.observedValue,
                          'detail'
                        );
                        return (
                          <span className={`px-2.5 py-0.5 rounded-md font-bold flex items-center gap-1 ${badge.badgeClass}`}>
                            {badge.kind === 'read_failed' || badge.kind === 'unverified_evidence' ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : badge.kind === 'verified' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : badge.kind === 'pending' ? (
                              <Clock className="w-3.5 h-3.5" />
                            ) : null}
                            <span>{badge.label}</span>
                          </span>
                        );
                      })()}
                    </div>

                    {canonicalDto.nextCheckAt && (
                      <div className="text-[11px] text-muted-foreground">
                        다음 확인 예정: {new Date(canonicalDto.nextCheckAt).toLocaleString("ko-KR")}
                      </div>
                    )}
                  </div>
                </section>

                {/* Active Mobile/Card Diff Display (Figma M20) */}
                {activePlanDiff && (
                  <div className="lg:hidden">
                    <MissionPlanDiffCard
                      planDiff={activePlanDiff}
                      onApprove={handleApplyPlanDiff}
                      onReject={() => setActivePlanDiff(null)}
                      isApplying={isSubmitting}
                    />
                  </div>
                )}

                {/* Explicit Contract Execution Approval Required (NEEDS_DECISION) */}
                {canonicalDto.executionState === 'NEEDS_DECISION' && (
                  <section
                    aria-label="업무 실행 최종 승인"
                    className="p-5 rounded-3xl bg-[#f8f5ff] dark:bg-purple-950/20 border border-[#dcd4fc] dark:border-purple-800 space-y-3"
                  >
                    <div className="flex items-center gap-2 text-primary font-bold text-sm">
                      <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                      <span>새 계약 조건에 대한 실행 최종 승인이 필요합니다</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      계획 변경안이 계약에 적용되었습니다. 실제 외부 발행이나 자동화 실행을 시작하려면 사장님의 명시적 승인이 필요합니다 (외부 쓰기 0건 보장 상태).
                    </p>
                    {contractApproval ? (
                      <ul className="space-y-1 text-xs text-foreground" aria-label="승인할 계약 조건">
                        {contractApproval.review_lines.map((line, index) => <li key={index}>{line}</li>)}
                      </ul>
                    ) : <p className="text-xs text-muted-foreground">승인 가능한 계약과 권한을 확인해 주세요.</p>}
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={handleApproveContract}
                        disabled={isSubmitting || !contractApproval}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer min-h-11 flex items-center justify-center gap-2 shadow-xs"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isSubmitting ? '승인 처리 중…' : '계약 최종 승인하고 실행 준비하기'}</span>
                      </button>
                    </div>
                  </section>
                )}

                {/* Active Rehearsal Card (ANI-1880) */}
                {activeRehearsal && (
                  <MissionRehearsalCard
                    rehearsal={activeRehearsal}
                    onPromoteToLive={handlePromoteToLive}
                    isPromoting={isSubmitting}
                  />
                )}

                {/* Conversational Modification & Pause Composer (ANI-1809 / ANI-1880) */}
                <section
                  aria-label="대화형 업무 수정 및 제어"
                  className="p-6 rounded-3xl bg-card border border-border shadow-xs space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <h2 className="text-sm font-bold text-foreground">
                        대화로 업무 조정하기
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSendIntent("일시정지")}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 min-h-9"
                    >
                      <PauseCircle className="w-3.5 h-3.5 text-amber-500" />
                      <span>업무 일시정지</span>
                    </button>
                  </div>

                  {/* Quick suggestion chips */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSendIntent("인스타만, 예산 그대로")}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-foreground font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      💡 &quot;인스타만, 예산 그대로&quot;
                    </button>
                    <button
                      type="button"
                      onClick={handleRunRehearsal}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      🎯 미리보기 리허설 실행
                    </button>
                  </div>

                  {/* Input form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendIntent();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      ref={adjustmentInput}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder='예: "인스타만 진행해줘", "예산 5만원으로 조정", "일시정지"'
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary min-h-11"
                      disabled={isSubmitting}
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting || !inputText.trim()}
                      className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer min-h-11 flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>전송</span>
                    </button>
                  </form>
                </section>

                {/* 🌟 2. Honest Errors Section (errors != empty/0, Korean allowlist copy) */}
                {canonicalDto.errors && canonicalDto.errors.length > 0 && (
                  <section
                    aria-label="확인 필요 사항"
                    className="p-6 rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300 text-sm">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>진행 확인 필요 사항 ({canonicalDto.errors.length}건)</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-amber-800 dark:text-amber-200 pt-1">
                      {canonicalDto.errors.map((err, idx) => (
                        <li key={idx} className="break-words font-medium">
                          {err}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              {/* Right Column: Execution Plan Rail (Figma D11 Desktop) */}
              <div className="hidden lg:block space-y-6">
                <MissionPlanDiffRail
                  planDiff={activePlanDiff}
                  onApplyPlan={handleApplyPlanDiff}
                  onApprove={handleApplyPlanDiff}
                  onReject={() => setActivePlanDiff(null)}
                  isApplying={isSubmitting}
                />
              </div>
            </div>

            {/* 🌟 3. Operational Direction via Real Chat */}
            <MissionConversationContinuation onContinue={handleOpenMissionChat} />
          </>
        )}
      </div>
    </FirstPostResume>
  );
}
