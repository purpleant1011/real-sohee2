'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  ShieldAlert,
  ChevronDown,
  Activity,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useSurfaceContext, getRouteDisplayName } from '@/features/agent-dock/surface-context';
import { approvalWriteKind, useProposalBus } from '@/features/agent-dock/proposal-bus';
import { parseControlCommand } from '@/features/agent-dock/parse-control-command';
import { parseDockActions, type DockAction } from '@/features/agent-intent/dock-actions';
import { consumeActivityStream } from '@/features/agent-activity/activity-stream';
import { isActivityId, type AgentActivityEvent } from '@/features/agent-activity/activity-event';
import { ActivityCursor, followActivity } from '@/features/agent-activity/activity-recovery';
import { AgentActivityTimeline } from '@/components/agent-activity/agent-activity-timeline';
import { ConversationTaskTimeline } from '@/features/chat/conversation-task-timeline';
import { activityTaskTimeline } from '@/features/agent-activity/task-timeline-adapter';
import { AgentReasonSummary } from '@/components/agent-activity/agent-reason-summary';
import { AgentArtifactPlanCard } from '@/components/agent-activity/agent-artifact-plan-card';
import { MissionEvidenceRail } from '@/components/agent-activity/mission-evidence-rail';
import { DockActionCard } from './dock-action-card';
import { ContentDraftCard, type ContentDraftCardData } from './content-draft-card';
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy';
import { useCreditBalance } from '@/hooks/use-credit-balance';
import { useAgentSession } from '@/hooks/use-agent-session';
import { DockControlBar } from './dock-control-bar';
import { OwnerExceptionCard } from './owner-exception-card';
import { OwnerException, ProposalPayload } from '@/features/agent-dock/types';
import { AgentLivingGreeting } from './agent-living-greeting';
import { AgentWorkStepTimeline } from './agent-work-step-timeline';
import { AgentQuickActionChips } from './agent-quick-action-chips';
import { generateLivingGreeting, type LivingGreetingResult } from '@/features/agent-dock/living-greeting';
import { ReservationDialog, type ReservationFormData } from '@/components/v088/customers/reservation-dialog';
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard';
import { reservationWriteKey } from '@/features/pwa/external-write';
import { toast } from 'sonner';

import {
  GoalCard,
  ApprovalCard,
  ExecutionCard,
  LiveExecutionCard,
  ProviderAcceptedCard,
  VerificationCard,
  EvidenceCard,
  BlockedCard,
  ResultUnknownCard,
  OutcomeCard,
  GoalCardProps,
  PlanCardProps,
  ApprovalCardProps,
  ExecutionCardProps,
  ProviderAcceptedCardProps,
  VerificationCardProps,
  EvidenceCardProps,
  ResultUnknownCardProps,
  BlockedCardProps,
  OutcomeCardProps,
  PerformanceSummaryCard,
  PerformanceSummaryCardData,
  mapActionRunStatusToKorean,
} from '@/features/action-graph/event-cards';
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card';
import type { RecoveryView } from '@/features/booking-recovery/contracts';
import { SafeChatMarkdown } from '@/features/chat-floor/safe-markdown';
import {
  PlanCardData,
  LiveExecutionCardData,
  DecisionCardData,
  EvidenceResultCardData,
} from '@/lib/agent-os/agent-orchestrator';

export interface ActionRunSummary {
  runId: string;
  goal: string;
  status: string;
  progress?: number;
  currentStep?: string;
}

export interface SoheeAgentDockProps {
  workspaceId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsible?: boolean;
  pendingExceptions?: OwnerException[];
  initialActionRun?: ActionRunSummary;
  initialInput?: string;
  /** 하단 입력바 등에서 온 대기 메시지. id가 바뀔 때마다 한 번만 전송된다. */
  autoSendMessage?: { id: string; text: string } | null;
  /** 대기 메시지의 전송을 시작하면 호출된다 (리마운트 시 중복 전송 방지용). */
  onAutoSendConsumed?: (id: string) => void;
}

export interface DockMessageItem {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: string;
  isControlEvent?: boolean;
  actions?: DockAction[];
  proposal?: ProposalPayload;
  goalCard?: GoalCardProps;
  planCard?: PlanCardData | null;
  missionId?: string;
  planVersion?: number;
  approvalInvalidated?: boolean;
  liveExecutionCard?: LiveExecutionCardData | null;
  executionCard?: ExecutionCardProps['card'];
  approvalCard?: ApprovalCardProps['card'] | null;
  providerAcceptedCard?: ProviderAcceptedCardProps;
  verificationCard?: VerificationCardProps;
  evidenceResultCard?: EvidenceResultCardData | null;
  evidenceCard?: EvidenceCardProps['evidence'];
  resultUnknownCard?: ResultUnknownCardProps;
  failureCard?: { errorCode: string; message: string; step: string } | null;
  blockedCard?: BlockedCardProps;
  contentDraftCard?: ContentDraftCardData | null;
  outcomeCard?: OutcomeCardProps;
  performanceSummaryCard?: PerformanceSummaryCardData | null;
  recoveryCard?: RecoveryView | null;
  actionRunId?: string;
  step?: string;
}

function requiresArtifactReview(message: DockMessageItem, messages: DockMessageItem[]): boolean {
  return messages.some(draft => draft.role !== 'user' && draft.contentDraftCard && (
    draft.id === message.id
    || (draft.missionId && draft.missionId === message.missionId)
    || (draft.actionRunId && draft.actionRunId === message.actionRunId)
  ));
}

const ARTIFACT_APPROVAL_BLOCKER = '원고·사진·계정·비용의 정확한 승인 조건을 먼저 확인해야 합니다.';

const INITIAL_GREETING = `안녕하세요 사장님! 마케팅을 돕는 AI 직원 소희예요.
"신메뉴 글 올려줘"처럼 말씀하시면 초안을 제안해요. 최종 발행은 직접 확인 후 승인해 주세요.`;

export function SoheeAgentDock({
  workspaceId = 'ws-default',
  isOpen = true,
  onClose,
  isCollapsible = false,
  pendingExceptions = [],
  initialActionRun,
  initialInput,
  autoSendMessage,
  onAutoSendConsumed,
}: SoheeAgentDockProps) {
  const { context } = useSurfaceContext();
  const { sessionId, threadId, isLoading: sessionLoading } = useAgentSession(workspaceId);
  const { isRunning, actualMode, killSwitchActive, isLoading: autonomyLoading, setAutonomy } = useSoheeAutonomy(workspaceId);
  const { balance, capacity, isLoading: isCreditsLoading, hasError: isCreditsError } = useCreditBalance(workspaceId);
  const { acceptProposal, rejectProposal, getProposal } = useProposalBus();

  const [input, setInput] = useState(initialInput || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeActionRun, setActiveActionRun] = useState<ActionRunSummary | null>(initialActionRun || null);
  const [showRunInspector, setShowRunInspector] = useState(false);
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([]);
  const [activityRecovery, setActivityRecovery] = useState<{ nextCheckAt: number | null; stopped?: boolean } | null>(null);
  const [progressSteps, setProgressSteps] = useState<Array<{
    stepIndex: number;
    kind: 'planning' | 'step_started' | 'step_done' | 'step_failed' | 'awaiting_approval';
    title: string;
    detail?: string;
  }>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activityGenerationRef = useRef(0);
  const activityRecoveryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (initialInput) {
      setInput(initialInput);
      inputRef.current?.focus();
    }
  }, [initialInput]);

  const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
  const [reservationInitData, setReservationInitData] = useState<{
    customerName: string;
    customerPhone?: string;
    suggestedTime?: string;
    serviceName?: string;
  } | null>(null);
  const [isSubmittingReservation, setIsSubmittingReservation] = useState(false);
  // 예약 확정은 외부 쓰기다. 오프라인이면 시작하지 않고, 중복 클릭은 한 번만 실행한다(ANI-1778).
  const runExternalWrite = useExternalWriteGuard();

  const handleOpenReservation = useCallback((data: {
    customerName: string;
    customerPhone?: string;
    suggestedTime?: string;
    serviceName?: string;
  }) => {
    setReservationInitData(data);
    setReservationDialogOpen(true);
  }, []);

  const handleConfirmReservation = async (formData: ReservationFormData) => {
    setIsSubmittingReservation(true);
    try {
      const outcome = await runExternalWrite(
        'reservation',
        reservationWriteKey(workspaceId, formData.customerName, formData.bookingStartsAt),
        async () => {
          const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reservations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...formData,
              notifyConsentAttested: Boolean(formData.notifyConsentAttested),
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(json.error || '예약을 등록하지 못했습니다.');
          }
        },
      );
      if (!outcome.ran) {
        toast.error(outcome.decision.message);
        return;
      }
      toast.success(`✨ ${formData.customerName} 고객님의 예약이 확정 등록되었습니다!`);
      setReservationDialogOpen(false);
      // 대화창에 확정 안내 메시지 추가
      setMessages((prev) => [
        ...prev,
        {
          id: `res-confirm-${Date.now()}`,
          role: 'assistant',
          content: `✅ **${formData.customerName}** 고객님의 예약이 성공적으로 확정되었습니다!\n- 일정: ${formData.bookingStartsAt}\n- 코스: ${formData.serviceName}\n\n고객 메뉴 및 캘린더에 안전하게 반영해 두었어요 🌿`,
          timestamp: '방금 전',
        },
      ]);
    } catch (err: any) {
      toast.error(err.message || '예약 등록 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingReservation(false);
    }
  };

  const [messages, setMessages] = useState<DockMessageItem[]>([
    {
      id: 'msg-init',
      role: 'assistant',
      content: INITIAL_GREETING,
      timestamp: '방금 전',
    },
  ]);

  const [exceptions, setExceptions] = useState<OwnerException[]>(pendingExceptions);
  const [livingGreeting, setLivingGreeting] = useState<LivingGreetingResult | null>(null);

  // Fetch real-time workspace engagement indicators for dynamic living greeting
  useEffect(() => {
    let cancelled = false;
    async function loadLivingSignals() {
      try {
        const [dmRes, cmRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/engagement/dm/threads`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/workspaces/${workspaceId}/engagement/comments`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;

        const urgentDmCount = Array.isArray(dmRes?.items) ? dmRes.items.filter((i: any) => i.status === 'NEEDS_REPLY').length : 0;
        const pendingCommentCount = Array.isArray(cmRes?.items) ? cmRes.items.filter((c: any) => c.status === 'DRAFTED' || c.status === 'RECEIVED').length : 0;
        const earliestDmHoursLeft = urgentDmCount > 0 ? 22 : 24;

        setLivingGreeting(generateLivingGreeting({
          businessName: context?.routeName ? undefined : undefined,
          urgentDmCount,
          earliestDmHoursLeft,
          pendingCommentCount,
        }));
      } catch {
        if (!cancelled) {
          setLivingGreeting(generateLivingGreeting({ businessName: undefined }));
        }
      }
    }
    loadLivingSignals();
    return () => { cancelled = true; };
  }, [workspaceId, context?.routeName]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const readingHistoryRef = useRef(false);
  const activityCountRef = useRef(0);
  const [unseenActivities, setUnseenActivities] = useState(0);
  const jumpToLatest = useCallback(() => {
    readingHistoryRef.current = false;
    setUnseenActivities(0);
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' });
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (pendingExceptions && pendingExceptions.length > 0) {
      setExceptions(pendingExceptions);
    }
  }, [pendingExceptions]);

  useEffect(() => {
    if (initialActionRun) {
      setActiveActionRun(initialActionRun);
    }
  }, [initialActionRun]);

  const historyScopeRef = useRef({ workspaceId, threadId });

  // Load thread history
  useEffect(() => {
    const previousScope = historyScopeRef.current;
    historyScopeRef.current = { workspaceId, threadId };
    if (previousScope.workspaceId !== workspaceId || (previousScope.threadId !== null && previousScope.threadId !== threadId)) {
      setMessages([{ id: 'msg-init', role: 'assistant', content: INITIAL_GREETING, timestamp: '방금 전' }]);
      setInput('');
      setActiveActionRun(null);
      setProgressSteps([]);
      readingHistoryRef.current = false;
      activityCountRef.current = 0;
      setUnseenActivities(0);
    }
    let isCancelled = false;
    const recoveryController = new AbortController();
    activityRecoveryControllerRef.current = recoveryController;
    const activityGeneration = ++activityGenerationRef.current;
    abortControllerRef.current?.abort();
    setActivityEvents([]);
    setActivityRecovery(null);
    const activeThreadId = threadId;
    if (!activeThreadId || !workspaceId) return;

    async function loadThreadHistory(tid: string) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat?threadId=${encodeURIComponent(tid)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isCancelled || !Array.isArray(data?.messages) || data.messages.length === 0) return;

        const loadedMessages: DockMessageItem[] = data.messages.map((m: any) => {
          const role: 'assistant' | 'user' | 'system' =
            m.role === 'sohee' || m.role === 'assistant'
              ? 'assistant'
              : m.role === 'user'
              ? 'user'
              : 'system';

          let contentDraftCard: ContentDraftCardData | null = m.contentDraftCard || null;
          const evidenceList = m.evidenceRefs || m.evidence_refs || [];
          if (!contentDraftCard && Array.isArray(evidenceList) && evidenceList.length > 0) {
            const found = evidenceList.find((r: any) => Array.isArray(r?.variants) && r.variants.length > 0);
            if (found) {
              contentDraftCard = {
                draftId: found.draftId || found.requestKey || '',
                topic: found.topic || '',
                variants: found.variants,
                openInStudioPath: found.openInStudioPath,
              };
            }
          }

          let approvalCard: DecisionCardData | null = m.approvalCard || null;
          let planCard: PlanCardData | null = m.planCard || null;
          let liveExecutionCard: LiveExecutionCardData | null = m.liveExecutionCard || null;

          // Rehydrate cards from usage_metadata / actionGraph if present
          const actionGraph = m.actionGraph || m.usageMetadata?.actionGraph || m.usage_metadata?.actionGraph;
          const toolCalls = m.toolCalls || m.tool_calls || m.usageMetadata?.toolCalls || m.usage_metadata?.toolCalls || [];

          if (!approvalCard && Array.isArray(actionGraph?.steps)) {
            const awaitingStep = actionGraph.steps.find((s: any) => s.status === 'AWAITING_APPROVAL' && s.proposal);
            if (awaitingStep?.proposal) {
              approvalCard = {
                decisionId: awaitingStep.proposal.proposalId,
                title: awaitingStep.proposal.title,
                options: [
                  { id: 'approve', label: '승인 및 실행', description: awaitingStep.proposal.description },
                  { id: 'reject', label: '반려' },
                ],
              };
            }
          }

          if (!approvalCard && Array.isArray(toolCalls)) {
            const awaitingCall = toolCalls.find((tc: any) => tc.status === 'AWAITING_APPROVAL' && tc.proposal);
            if (awaitingCall?.proposal) {
              approvalCard = {
                decisionId: awaitingCall.proposal.proposalId,
                title: awaitingCall.proposal.title,
                options: [
                  { id: 'approve', label: '승인 및 실행', description: awaitingCall.proposal.description },
                  { id: 'reject', label: '반려' },
                ],
              };
            }
          }

          if (!planCard && Array.isArray(actionGraph?.steps) && actionGraph.steps.length > 0) {
            const primaryTool = actionGraph.steps[0]?.toolId || actionGraph.steps[0]?.toolName;
            planCard = {
              planId: `plan-${actionGraph.runId || m.runId || 'rehydrated'}`,
              title: `${primaryTool || '마케팅 작업'} 계획`,
              steps: actionGraph.steps.map((s: any) => ({
                name: s.toolName || s.toolId || '작업 단계',
                sc: s.creditDeducted || 0,
                risk: 'LOW',
                riskLabel: '안전',
              })),
              totalSC: actionGraph.steps.reduce((acc: number, s: any) => acc + (s.creditDeducted || 0), 0),
              requiresApproval: actionGraph.steps.some((s: any) => s.status === 'AWAITING_APPROVAL'),
            };
          }

          if (!liveExecutionCard && actionGraph) {
            const lastStep = actionGraph.steps?.[actionGraph.steps?.length - 1];
            liveExecutionCard = {
              planId: `plan-${actionGraph.runId || m.runId || 'rehydrated'}`,
              progressPercentage: actionGraph.status === 'COMPLETED' ? 100 : actionGraph.status === 'AWAITING_APPROVAL' ? 50 : 100,
              currentStepName: lastStep?.toolName || '작업 완료',
              status: actionGraph.status === 'COMPLETED' ? 'COMPLETED' : actionGraph.status === 'AWAITING_APPROVAL' ? 'RUNNING' : 'FAILED',
              logs: ['작업 기록 복원 완료'],
            };
          }

          return {
            id: m.id || `hist-${Date.now()}-${Math.random()}`,
            role,
            content: m.content || '',
            timestamp: m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '이전 대화',
            isControlEvent: role === 'system',
            contentDraftCard,
            approvalCard: approvalCard || m.approvalCard,
            planCard: planCard || m.planCard,
            liveExecutionCard: liveExecutionCard || m.liveExecutionCard,
            ...m,
            missionId: m.missionId || m.usageMetadata?.missionId || m.usage_metadata?.missionId,
            planVersion: m.planVersion ?? m.usageMetadata?.planVersion ?? m.usage_metadata?.planVersion ?? 0,
            ...(planCard && (m.usageMetadata?.planDiffSummary || m.usage_metadata?.planDiffSummary) ? {
              planCard: { ...planCard, diffSummary: m.usageMetadata?.planDiffSummary || m.usage_metadata?.planDiffSummary },
            } : {}),
            actionRunId: m.actionRunId || m.runId || m.usageMetadata?.runId || m.usage_metadata?.runId,
            actions: parseDockActions(m.actions),
          };
        });

        if (loadedMessages.length > 0) {
          setMessages((prev) => {
            const extraMessages = prev.filter((p) => {
              if (p.id === 'msg-init') return false;
              if (loadedMessages.some((m) => m.id === p.id)) return false;
              if (loadedMessages.some((m) => m.role === p.role && m.content === p.content)) return false;
              return true;
            });
            const restoredMessages = [...loadedMessages, ...extraMessages];
            const latestVersions = new Map<string, number>();
            for (const message of restoredMessages) {
              if (message.missionId) {
                latestVersions.set(message.missionId, Math.max(latestVersions.get(message.missionId) ?? 0, message.planVersion ?? 0));
              }
            }
            return restoredMessages.map((message) => message.missionId && (message.planVersion ?? 0) < (latestVersions.get(message.missionId) ?? 0)
              ? { ...message, approvalInvalidated: true }
              : message);
          });
        }

        const savedRun = [...data.messages].reverse().find((message: any) => isActivityId(message.runId));
        if (savedRun && !isCancelled && activityGenerationRef.current === activityGeneration) {
          await followActivity(new ActivityCursor(workspaceId, savedRun.runId), {
            signal: recoveryController.signal,
            onActivity: (event) => {
              if (!isCancelled && activityGenerationRef.current === activityGeneration) {
                setActivityEvents((previous) => [...previous, event]);
              }
            },
            onPending: (nextCheckAt) => {
              if (!isCancelled && activityGenerationRef.current === activityGeneration) {
                setActivityRecovery({ nextCheckAt });
              }
            },
          });
          if (!isCancelled && activityGenerationRef.current === activityGeneration) {
            setActivityRecovery((previous) => previous?.nextCheckAt === null ? previous : null);
          }
        }
      } catch (err) {
        if (isCancelled || recoveryController.signal.aborted || activityGenerationRef.current !== activityGeneration) return;
        setActivityRecovery(null);
        console.error('[SoheeAgentDock] Failed to restore thread history:', err);
      }
    }

    loadThreadHistory(activeThreadId);
    return () => {
      isCancelled = true;
      recoveryController.abort();
    };
  }, [workspaceId, threadId]);

  useEffect(() => {
    const added = Math.max(0, activityEvents.length - activityCountRef.current);
    activityCountRef.current = activityEvents.length;
    if (!activityEvents.length) setUnseenActivities(0);
    if (readingHistoryRef.current) {
      if (added) setUnseenActivities(count => count + added);
      return;
    }
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' });
  }, [messages, activityEvents]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleEmergencyStop = useCallback(async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/agent/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_kill_switch',
          killSwitchActive: true,
          reason: '사장님 도크 콘솔 긴급 차단(Kill Switch) 가동',
        }),
      });
      await setAutonomy(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `ctrl-${Date.now()}`,
          role: 'system',
          content: '🚨 자동 작업이 긴급 정지되었습니다.',
          timestamp: '방금 전',
          isControlEvent: true,
        },
      ]);
    } catch {}
  }, [workspaceId, setAutonomy]);

  const handlePause = useCallback(async () => {
    await setAutonomy(false);
    setMessages((prev) => [
      ...prev,
      {
        id: `ctrl-${Date.now()}`,
        role: 'system',
        content: '⏸️ 소희의 자율근무가 일시 정지되었습니다.',
        timestamp: '방금 전',
        isControlEvent: true,
      },
    ]);
  }, [setAutonomy]);

  const handleResume = useCallback(async () => {
    if (killSwitchActive) {
      try {
        await fetch(`/api/workspaces/${workspaceId}/agent/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'toggle_kill_switch',
            killSwitchActive: false,
            reason: '사장님 도크 콘솔 긴급 차단 해제 및 업무 재개',
          }),
        });
      } catch {}
    }
    await setAutonomy(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `ctrl-${Date.now()}`,
        role: 'system',
        content: '▶️ 소희의 자율근무가 재개되었습니다.',
        timestamp: '방금 전',
        isControlEvent: true,
      },
    ]);
  }, [killSwitchActive, workspaceId, setAutonomy]);

  const handleApproveProposal = useCallback(
    async (proposalId: string) => {
      // 서버 승인 레코드 버전을 함께 보내 동시 승인(CAS)을 서버가 판정하게 한다.
      const ok = await acceptProposal(proposalId, getProposal(proposalId)?.version);
      if (ok) {
        setExceptions((prev) =>
          prev.map((ex) =>
            ex.proposal?.id === proposalId
              ? { ...ex, proposal: { ...ex.proposal, status: 'ACCEPTED' } }
              : ex
          )
        );
      }
    },
    [acceptProposal, getProposal]
  );

  const handleRejectProposal = useCallback(
    async (proposalId: string) => {
      const ok = await rejectProposal(proposalId);
      if (ok) {
        setExceptions((prev) =>
          prev.map((ex) =>
            ex.proposal?.id === proposalId
              ? { ...ex, proposal: { ...ex.proposal, status: 'REJECTED' } }
              : ex
          )
        );
      }
    },
    [rejectProposal]
  );

  const handleDismissException = useCallback((exceptionId: string) => {
    setExceptions((prev) => prev.filter((ex) => ex.id !== exceptionId));
  }, []);

  const handleApproveDecision = useCallback(
    async (decisionId: string, _optionId?: string, expectedVersion?: number | string) => {
      const message = messages.find(item => item.approvalCard?.decisionId === decisionId);
      if (message && requiresArtifactReview(message, messages)) {
        return { success: false, status: 'FAILED' as const, error: ARTIFACT_APPROVAL_BLOCKER };
      }
      const approveDecision = async () => {
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proposalId: decisionId,
              action: 'APPROVE',
              expectedVersion,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            if (data.executionResult && data.executionResult.success === false) {
              const execErr =
                data.executionResult.error?.message ||
                data.executionResult.statusMessage ||
                '승인 처리 후 후속 작업 실행에 실패했습니다.';
              setMessages((prev) => [
                ...prev,
                {
                  id: `asst-appr-err-${Date.now()}`,
                  role: 'assistant',
                  content: `⚠️ 승인은 기록되었으나, 실행 중 문제가 발생했습니다: ${execErr}`,
                  timestamp: '방금 전',
                },
              ]);
              return { success: false, status: 'FAILED' as const, error: execErr };
            }

            setMessages((prev) => [
              ...prev,
              {
                id: `asst-appr-${Date.now()}`,
                role: 'assistant',
                content: '승인이 기록되었습니다. 실행 결과는 별도로 확인해야 합니다.',
                timestamp: '방금 전',
              },
            ]);
            return { success: true, status: 'APPROVED' as const };
          } else {
            const errMsg = data.error?.message || '승인 처리 중 오류가 발생했습니다.';
            setMessages((prev) => [
              ...prev,
              {
                id: `asst-appr-err-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ 승인 처리 중 문제가 발생했습니다: ${errMsg}`,
                timestamp: '방금 전',
              },
            ]);
            const status = res.status === 409 || data.error?.code === 'VERSION_CONFLICT'
              ? 'VERSION_CONFLICT' as const
              : res.status === 410 || data.error?.code === 'APPROVAL_EXPIRED'
                ? 'EXPIRED' as const
                : 'FAILED' as const;
            return { success: false, status, error: errMsg };
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.';
          return { success: false, status: 'FAILED' as const, error: errMsg };
        }
      };

      // 승인은 서버에서 발송·게시·예약 같은 외부 쓰기를 실행한다. 오프라인이면 요청을 내보내지 않고,
      // 같은 승인이 진행 중이면 두 번째 클릭은 아무 것도 하지 않는다.
      const outcome = await runExternalWrite(approvalWriteKind(), decisionId, approveDecision);

      if (!outcome.ran) {
        setMessages((prev) => [
          ...prev,
          {
            id: `asst-appr-blocked-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ ${outcome.decision.message}`,
            timestamp: '방금 전',
          },
        ]);
        return { success: false, status: 'FAILED' as const, error: outcome.decision.message };
      }
      return outcome.value;
    },
    [workspaceId, runExternalWrite, messages]
  );

  const handleRejectDecision = useCallback(
    async (decisionId: string) => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId: decisionId,
            action: 'REJECT',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setMessages((prev) => [
            ...prev,
            {
              id: `asst-rej-${Date.now()}`,
              role: 'assistant',
              content: '반려가 기록되었습니다. (진행 중인 작업은 안전하게 마무리돼요)',
              timestamp: '방금 전',
            },
          ]);
          return { success: true, status: 'REJECTED' as const };
        } else {
          const errMsg = data.error?.message || '반려 처리 중 오류가 발생했습니다.';
          return { success: false, status: 'FAILED' as const, error: errMsg };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.';
        return { success: false, status: 'FAILED' as const, error: errMsg };
      }
    },
    [workspaceId]
  );

  const handleSubmit = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const query = (overrideText ?? input).trim();
    if (!query || isSubmitting) return;

    setInput('');
    const clientMessageId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `msg-${Date.now()}`;

    const userMessage: DockMessageItem = {
      id: clientMessageId,
      role: 'user',
      content: query,
      timestamp: '방금 전',
    };

    setMessages((prev) => [...prev, userMessage]);

    const controlCmd = parseControlCommand(query);
    if (controlCmd.type === 'EMERGENCY_STOP') {
      await handleEmergencyStop();
      return;
    }
    if (controlCmd.type === 'PAUSE') {
      await handlePause();
      return;
    }
    if (controlCmd.type === 'RESUME') {
      await handleResume();
      return;
    }

    // 주간 성과 리포트 카드 인터셉트 & 시각화 (Truth-preserving fail-closed)
    if (query.includes('성과 요약') || query.includes('지난주 성과') || query === '📊 지난주 성과 요약') {
      setIsSubmitting(true);
      try {
        const [pipelineRes, quickPostRes] = await Promise.all([
          fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/customers/pipeline`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/quick-post`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);

        if (
          !pipelineRes ||
          !quickPostRes ||
          !pipelineRes.kpis ||
          typeof pipelineRes.kpis.inquiryCount !== 'number' ||
          typeof pipelineRes.kpis.bookedCount !== 'number'
        ) {
          setMessages((prev) => [
            ...prev,
            {
              id: `perf-summary-${Date.now()}`,
              role: 'assistant',
              content: '📊 성과 내역을 불러오지 못했어요. 다시 시도해 주세요.',
              timestamp: '방금 전',
            },
          ]);
          return;
        }

        // 오직 게시 readback 검증이 완료된 PUBLISHED_VERIFIED만 집계 (COMPLETED 및 APPROVAL 제외)
        const postsCount = Array.isArray(quickPostRes?.items)
          ? quickPostRes.items.filter((p: any) => p.status === 'PUBLISHED_VERIFIED').length
          : 0;
        const inqCount = pipelineRes.kpis.inquiryCount;
        const resCount = pipelineRes.kpis.bookedCount;
        const topPost = Array.isArray(quickPostRes?.items)
          ? quickPostRes.items.find((p: any) => p.status === 'PUBLISHED_VERIFIED')?.topic
          : undefined;

        setMessages((prev) => [
          ...prev,
          {
            id: `perf-summary-${Date.now()}`,
            role: 'assistant',
            content: '📊 확인된 소통 및 게시 현황이에요.\n(현재 확인된 최근 목록으로 안내해 드려요.)',
            timestamp: '방금 전',
            performanceSummaryCard: {
              period: '현재 확인된 목록 (실측 기간 미보장)',
              postsCount,
              inquiriesCount: inqCount,
              reservationsCount: resCount,
              estimatedSavingsWon: null, // 미관측 상태 정직하게 보존 (0원으로 오인 차단)
              topPostTopic: topPost,
              summaryComment: '현재 확인된 누적 내역이에요.',
            },
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `perf-summary-${Date.now()}`,
            role: 'assistant',
            content: '📊 성과 내역을 불러오지 못했어요. 다시 시도해 주세요.',
            timestamp: '방금 전',
          },
        ]);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 예약 문의 회수 카드 인터셉트 (Truth-preserving fail-closed)
    if (query === '💌 인스타 예약 문의 확인해줘' || query.includes('예약 문의 확인')) {
      setIsSubmitting(true);
      try {
        const casesRes = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases`
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        const cases: RecoveryView[] = casesRes?.cases || [];
        if (cases.length === 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: `recovery-empty-${Date.now()}`,
              role: 'assistant',
              content: '현재 대기 중인 예약 문의가 없어요.',
              timestamp: '방금 전',
            },
          ]);
        } else if (cases.length === 1) {
          const singleCase = cases[0];
          setMessages((prev) => [
            ...prev,
            {
              id: `recovery-${singleCase.caseId}-${Date.now()}`,
              role: 'assistant',
              content: `💌 확인이 필요한 예약 문의예요.`,
              timestamp: '방금 전',
              recoveryCard: singleCase,
            },
          ]);
        } else {
          // 다수 케이스 존재 시 임의 선택 금지 -> 선택 목록 제공 (Task 9 계약 준수)
          setMessages((prev) => [
            ...prev,
            {
              id: `recovery-list-${Date.now()}`,
              role: 'assistant',
              content: `💌 대기 중인 예약 문의가 ${cases.length}건 있습니다:\n` +
                cases
                  .map((c, idx) => `${idx + 1}. ${c.offer?.serviceName || '서비스 문의'} (${c.statusLabel})`)
                  .join('\n') +
                `\n\n고객 화면에서 확인하실 수 있어요.`,
              timestamp: '방금 전',
              actions: [
                { type: 'navigate', path: '/app/customers' },
              ],
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `recovery-err-${Date.now()}`,
            role: 'assistant',
            content: '예약 문의를 불러오지 못했어요. 다시 시도해 주세요.',
            timestamp: '방금 전',
          },
        ]);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    activityRecoveryControllerRef.current?.abort();
    activityGenerationRef.current += 1;
    setActivityEvents([]);
    setActivityRecovery(null);
    setProgressSteps([]);
    setIsSubmitting(true);

    try {
      const currentPlan = [...messages].reverse().find(message => message.missionId && message.actionRunId);
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId,
          threadId,
          message: query,
          currentUserMessage: query,
          ...(currentPlan ? { missionId: currentPlan.missionId, previousRunId: currentPlan.actionRunId, expectedPlanVersion: currentPlan.planVersion ?? 0 } : {}),
          clientMessageId,
          surfaceContext: context,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const applyResultData = (data: any) => {
        const replyText =
          data?.reply ||
          data?.content ||
          (data?.step === 'BLOCKED'
            ? '⚠️ 실행 조건이 충족되지 않아 중단되었습니다.'
            : '⚠️ 응답 내용이 비어 있습니다. 잠시 후 다시 시도해 주세요.');

        let contentDraftCard: ContentDraftCardData | null = null;
        if (data?.variants && Array.isArray(data.variants) && data.variants.length > 0) {
          contentDraftCard = {
            draftId: data.draftId || data.requestKey || '',
            topic: data.topic || '',
            variants: data.variants,
            openInStudioPath: data.openInStudioPath,
          };
        }

        const isGeneralReply = data?.step === 'GENERAL_REPLY';

        if (data?.runId && !isGeneralReply) {
          setActiveActionRun({
            runId: data.runId,
            goal: query,
            status: data.step || 'RUNNING',
            progress: data.liveExecutionCard?.progressPercentage || 50,
          });
        }

        const newMsg: DockMessageItem = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: replyText,
          timestamp: '방금 전',
          actions: parseDockActions(data?.actions),
          goalCard: data?.goalCard,
          planCard: data?.planCard,
          missionId: typeof data?.missionId === 'string' ? data.missionId : undefined,
          planVersion: Number.isSafeInteger(data?.planVersion) ? data.planVersion : 0,
          liveExecutionCard: isGeneralReply ? undefined : data?.liveExecutionCard,
          executionCard: isGeneralReply ? undefined : data?.executionCard,
          approvalCard: data?.approvalCard,
          evidenceResultCard: data?.evidenceResultCard,
          failureCard: data?.failureCard,
          contentDraftCard,
          providerAcceptedCard: data?.providerAcceptedCard,
          verificationCard: data?.verificationCard,
          resultUnknownCard: data?.resultUnknownCard,
          outcomeCard: data?.outcomeCard,
          actionRunId: isGeneralReply ? undefined : data?.runId,
          step: data?.step,
        };

        setMessages((prev) => [...prev.map(item =>
          newMsg.missionId && item.missionId === newMsg.missionId && (item.planVersion ?? 0) < (newMsg.planVersion ?? 0)
            ? { ...item, approvalInvalidated: true } : item
        ), newMsg]);
      };

      if (res.ok) {
        const isStream = Boolean(
          typeof res.headers?.get === 'function' &&
          res.headers.get('content-type')?.includes('text/event-stream') &&
          res.body
        );

        if (isStream) {
          let hasResult = false;
          await consumeActivityStream(res.body!, {
            workspaceId,
            signal: abortController.signal,
            onActivity: (event) => setActivityEvents((previous) => [...previous, event]),
            onPending: (nextCheckAt) => setActivityRecovery({ nextCheckAt }),
            onFrame: (sse) => {
            if (sse.event === 'run') {
              if (sse.data?.runId) {
                setActiveActionRun({
                  runId: sse.data.runId,
                  goal: query,
                  status: 'RUNNING',
                  progress: 20,
                });
              }
            } else if (sse.event === 'progress') {
              setProgressSteps((prev) => {
                let updated = [...prev];
                // 후속 작업(step_started, step_done 등)이 도착하면 아직 진행 중(스피너)으로 남아있던 이전 planning 단계를 완료(✓) 처리
                if (sse.data.kind !== 'planning') {
                  updated = updated.map((step) => {
                    if (step.kind === 'planning') {
                      return {
                        ...step,
                        kind: 'step_done',
                        title: '작업 계획 수립 완료',
                        detail: '실행 계획 수립이 완료되었습니다.',
                      };
                    }
                    return step;
                  });
                }
                const existingIdx = updated.findIndex(
                  (s) => s.stepIndex === sse.data.stepIndex && s.title === sse.data.title
                );
                if (existingIdx >= 0) {
                  updated[existingIdx] = sse.data;
                } else {
                  updated.push(sse.data);
                }
                return updated;
              });
            } else if (sse.event === 'result') {
              hasResult = true;
              applyResultData(sse.data);
            } else if (sse.event === 'error') {
              hasResult = true;
              setMessages((prev) => [
                ...prev,
                {
                  id: `asst-err-${Date.now()}`,
                  role: 'assistant',
                  content: sse.data?.message || '⚠️ 일시적 오류가 발생했어요. 다시 시도해 주세요.',
                  timestamp: '방금 전',
                },
              ]);
            }
            },
          });

          if (!hasResult) {
            setMessages((prev) => [
              ...prev,
              {
                id: `asst-err-${Date.now()}`,
                role: 'assistant',
                content: '연결이 잠시 끊겼어요. 소희는 작업을 계속하고 있을 수 있어요. 잠시 뒤 대화 기록에서 결과를 확인해 주세요.',
                timestamp: '방금 전',
              },
            ]);
          }
        } else {
          const data = await res.json();
          applyResultData(data);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `asst-err-${Date.now()}`,
            role: 'assistant',
            content: '연결이 잠시 끊겼어요. 소희는 작업을 계속하고 있을 수 있어요. 같은 지시를 다시 보내기 전에 잠시 뒤 대화 기록에서 결과를 확인해 주세요.',
            timestamp: '방금 전',
          },
        ]);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-neterr-${Date.now()}`,
          role: 'assistant',
          content: '⚠️ 연결에 실패했어요. 상태 확인 후 다시 시도해 주세요.',
          timestamp: '방금 전',
        },
      ]);
    } finally {
      setActivityRecovery((previous) => previous?.nextCheckAt === null ? previous : null);
      setIsSubmitting(false);
      setProgressSteps([]);
    }
  };

  const [lastAutoSentId, setLastAutoSentId] = useState<string | null>(null);
  const lastAutoSentIdRef = useRef<string | null>(null);
  const autoSendWaiting =
    !!autoSendMessage && autoSendMessage.id !== lastAutoSentId && sessionLoading;

  useEffect(() => {
    if (!autoSendMessage || autoSendMessage.id === lastAutoSentIdRef.current) return;
    // 세션 준비 중이거나 다른 전송 중이면 입력창은 건드리지 않고 다음 렌더에서 다시 시도한다.
    if (sessionLoading || isSubmitting) return;
    lastAutoSentIdRef.current = autoSendMessage.id;
    setLastAutoSentId(autoSendMessage.id);
    onAutoSendConsumed?.(autoSendMessage.id);
    void handleSubmit(undefined, autoSendMessage.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendMessage, sessionLoading, isSubmitting]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!isOpen) return null;

  const taskRunId = activeActionRun?.runId ?? activityEvents.at(-1)?.run_id;
  const taskTimeline = taskRunId ? activityTaskTimeline(activityEvents, {
    workspaceId, runId: taskRunId, live: isSubmitting,
  }) : null;
  const evidenceScope = messages.findLast(message =>
    message.role !== 'user' && message.planCard && message.missionId && message.actionRunId
  );

  return (
    <aside
      data-testid="sohee-agent-dock"
      aria-label="소희 자율 에이전트 도크"
      className="@container w-full h-full min-w-0 flex flex-col bg-card select-text"
    >
      {/* Header */}
      <div className="p-3.5 border-b border-border flex items-center justify-between bg-card">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-2xs font-extrabold text-xs">
              소희
            </div>
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${
                killSwitchActive || actualMode === 'BLOCKED'
                  ? 'bg-rose-500'
                  : isRunning
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-zinc-400'
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-extrabold text-foreground">소희 (자율 에이전트)</h3>
            </div>
            {/* Context Awareness Surface Badge */}
            <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              <span>화면 인지: {getRouteDisplayName(context.routeName)}</span>
              {context.tab && <span className="text-purple-600 dark:text-purple-400">({context.tab})</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              aria-label="대화창 닫기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Control Bar */}
      <DockControlBar
        actualMode={actualMode}
        isRunning={isRunning}
        killSwitchActive={killSwitchActive}
        isLoading={autonomyLoading}
        onPause={handlePause}
        onResume={handleResume}
        onEmergencyStop={handleEmergencyStop}
      />

      {/* Persistent ActionRun & ActionGraph Inspector Bar */}
      {activeActionRun && activeActionRun.status !== 'GENERAL_REPLY' && (
        <div data-testid="active-run-bar" className="px-3.5 py-2 bg-purple-50/70 dark:bg-purple-950/40 border-b border-purple-200/60 dark:border-purple-900/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate">
            <Layers className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <div className="truncate">
              <div className="text-[10px] font-bold text-purple-700 dark:text-purple-300">
                진행 중인 작업
              </div>
              <div className="text-[11px] font-medium text-foreground truncate max-w-[200px]">
                {activeActionRun.goal}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-200/70 dark:bg-purple-900 text-purple-800 dark:text-purple-200 shrink-0">
            {mapActionRunStatusToKorean(activeActionRun.status)}
          </span>
        </div>
      )}

      {/* Human-in-the-loop Exception Cards */}
      {exceptions.length > 0 && (
        <div className="p-3 bg-muted/20 border-b border-border/60 space-y-2 max-h-48 overflow-y-auto">
          {exceptions.map((ex) => (
            <OwnerExceptionCard
              key={ex.id}
              exception={ex}
              onApproveProposal={handleApproveProposal}
              onRejectProposal={handleRejectProposal}
              onDismiss={handleDismissException}
            />
          ))}
        </div>
      )}

      <div className={`flex-1 min-h-0 min-w-0 grid grid-cols-1 ${evidenceScope ? 'grid-rows-[minmax(0,1fr)_auto] @[800px]:grid-cols-[minmax(0,1fr)_18rem] @[800px]:grid-rows-1' : 'grid-rows-1'}`}>
      {/* Messages Scroll Area with 10 Structured State Cards */}
      <div role="region" aria-label="소희와의 대화" tabIndex={0} onScroll={event => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        readingHistoryRef.current = scrollHeight - scrollTop - clientHeight > 64;
        if (!readingHistoryRef.current) setUnseenActivities(0);
      }} className="flex-1 min-w-0 p-3.5 overflow-y-auto space-y-3 min-h-0 bg-background/50">
        {/* 🌟 상황 인지형 다이내믹 출근 보고 카드 */}
        {livingGreeting ? (
          <AgentLivingGreeting greeting={livingGreeting} />
        ) : null}
        {messages.map((msg, idx) => {
          if (msg.isControlEvent) {
            return (
              <div
                key={msg.id}
                className="py-1 px-2.5 rounded-lg bg-muted/60 text-[10px] font-mono text-muted-foreground flex items-center justify-between mx-auto max-w-[95%]"
              >
                <span>{msg.content}</span>
                <span className="text-[9px]">{msg.timestamp}</span>
              </div>
            );
          }

          const isUser = msg.role === 'user';
          const artifactApprovalBlocked = !!msg.approvalCard && requiresArtifactReview(msg, messages);

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="size-6 rounded-full overflow-hidden ring-1 ring-purple-500/30 bg-purple-100 shrink-0 mt-0.5 shadow-2xs">
                  <Image
                    src="/brand/sohee-character-v1.png"
                    alt="소희"
                    width={24}
                    height={24}
                    className="size-full object-cover"
                  />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs ${
                  isUser
                    ? 'bg-purple-600 text-white rounded-br-xs font-medium'
                    : 'bg-card border border-border/80 text-foreground rounded-bl-xs'
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <SafeChatMarkdown content={msg.content} />
                )}

                {/* 10 Structured State Cards Rendering */}
                {!isUser && (
                  <div className="mt-2 space-y-1.5">
                    {msg.actions && msg.actions.length > 0 && (
                      <DockActionCard
                        workspaceId={workspaceId}
                        actions={msg.actions}
                        onOpenReservation={handleOpenReservation}
                      />
                    )}
                    {msg.goalCard && <GoalCard {...msg.goalCard} />}
                    {msg.planCard && <AgentArtifactPlanCard
                      key={`${workspaceId}:${msg.missionId || msg.planCard.planId}`}
                      plan={msg.planCard}
                      missionId={msg.missionId}
                      workspaceId={workspaceId}
                      runId={msg.actionRunId}
                      showEvidence={false}
                      onApprovalInvalidated={() => setMessages(previous => previous.map(item =>
                        item.id === msg.id || (msg.missionId && item.missionId === msg.missionId)
                          ? { ...item, approvalInvalidated: true }
                          : item
                      ))}
                    />}
                    {msg.approvalInvalidated && msg.approvalCard && <p role="status">초안이 변경되어 이전 승인을 사용할 수 없습니다. 새 승인 요청에서 확인해 주세요.</p>}
                    {msg.contentDraftCard && (
                      <ContentDraftCard card={msg.contentDraftCard} workspaceId={workspaceId}
                        missionId={msg.missionId} runId={msg.actionRunId}
                        onApprovalInvalidated={() => setMessages(previous => previous.map(item =>
                          item.id === msg.id || (msg.missionId && item.missionId === msg.missionId)
                            || (msg.actionRunId && item.actionRunId === msg.actionRunId)
                            ? { ...item, approvalInvalidated: true } : item
                        ))}
                      />
                    )}
                    {artifactApprovalBlocked && !msg.approvalInvalidated && <p role="status">{ARTIFACT_APPROVAL_BLOCKER}</p>}
                    {msg.approvalCard && !msg.approvalInvalidated && !artifactApprovalBlocked && (
                      <ApprovalCard
                        card={msg.approvalCard}
                        onApprove={(decisionId, optionId) => handleApproveDecision(decisionId, optionId, msg.approvalCard?.expectedVersion)}
                        onReject={handleRejectDecision}
                      />
                    )}
                    {(msg.executionCard || msg.liveExecutionCard) && msg.step !== 'GENERAL_REPLY' && (
                      <ExecutionCard card={(msg.executionCard || msg.liveExecutionCard)!} />
                    )}
                    {msg.providerAcceptedCard && (
                      <ProviderAcceptedCard {...msg.providerAcceptedCard} />
                    )}
                    {msg.verificationCard && (
                      <VerificationCard {...msg.verificationCard} />
                    )}
                    {(msg.evidenceCard || msg.evidenceResultCard) && (
                      <EvidenceCard
                        evidence={(msg.evidenceCard || msg.evidenceResultCard)!}
                        onNavigate={(url) => {
                          if (typeof window !== 'undefined') window.location.href = url;
                        }}
                      />
                    )}
                    {msg.resultUnknownCard && (
                      <ResultUnknownCard {...msg.resultUnknownCard} />
                    )}
                    {msg.failureCard && (
                      <BlockedCard
                        errorCode={msg.failureCard.errorCode}
                        message={msg.failureCard.message}
                        step={msg.failureCard.step}
                      />
                    )}
                    {msg.blockedCard && <BlockedCard {...msg.blockedCard} />}
                    {msg.step === 'BLOCKED' && !msg.failureCard && !msg.blockedCard && (
                      <BlockedCard
                        errorCode="BLOCKED_BY_POLICY"
                        message="실행 정책 및 조건 미충족으로 중단되었습니다."
                      />
                    )}
                    {msg.outcomeCard && <OutcomeCard {...msg.outcomeCard} />}
                    {msg.performanceSummaryCard && (
                      <PerformanceSummaryCard card={msg.performanceSummaryCard} />
                    )}
                    {msg.recoveryCard && (
                      <div className="mt-2">
                        <RecoveryCard
                          view={msg.recoveryCard}
                          onCommand={async (cmd) => {
                            // 외부로 나가는 회수 명령(답변 전송 승인·예약 확정 승인)만 가드한다.
                            // 준비·거절·재확인은 외부 쓰기가 아니라 그대로 보낸다(ANI-1778).
                            const kind =
                              cmd.kind === 'approve_send'
                                ? ('send' as const)
                                : cmd.kind === 'approve_booking'
                                  ? ('reservation' as const)
                                  : null;
                            const submit = async () => {
                              const res = await fetch(
                                `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases/${encodeURIComponent(msg.recoveryCard!.caseId)}/commands`,
                                {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(cmd),
                                }
                              );
                              const json = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                throw new Error(json.error || json.message || '명령 처리에 실패했습니다.');
                              }
                              if (json.view) {
                                setMessages((prev) =>
                                  prev.map((m) =>
                                    m.id === msg.id ? { ...m, recoveryCard: json.view } : m
                                  )
                                );
                              }
                            };
                            if (!kind) return submit();
                            const outcome = await runExternalWrite(kind, `recovery:${msg.recoveryCard!.caseId}`, submit);
                            // 카드가 이 예외를 오류 문구로 표시한다 — 막힌 이유를 삼키지 않는다.
                            if (!outcome.ran) throw new Error(outcome.decision.message);
                            return outcome.value;
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <span
                  className={`text-[9px] block text-right mt-1 font-mono ${
                    isUser ? 'text-purple-200' : 'text-muted-foreground'
                  }`}
                >
                  {msg.timestamp}
                </span>

                {/* 마지막 어시스턴트 메시지 하단에 퀵 액션 칩 배치 */}
                {!isUser && idx === messages.length - 1 ? (
                  <AgentQuickActionChips
                    chips={[
                      '📊 지난주 성과 요약',
                      '💡 스레드 칭찬 답글 달아줘',
                      '💌 인스타 예약 문의 확인해줘',
                      '✨ 이번 주 추천 소식 기획해줘',
                    ]}
                    disabled={isSubmitting}
                    onSelectChip={(chipText) => void handleSubmit(undefined, chipText)}
                  />
                ) : null}
              </div>
              {isUser && (
                <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0 text-xs font-bold mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
        {isSubmitting && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 max-w-[88%]"
          >
            <div className="size-6 rounded-full overflow-hidden ring-1 ring-purple-500/30 bg-purple-100 shrink-0 mt-0.5 shadow-2xs">
              <Image
                src="/brand/sohee-character-v1.png"
                alt="소희"
                width={24}
                height={24}
                className="size-full object-cover"
              />
            </div>
            <div className="p-3 rounded-2xl rounded-tl-xs bg-muted text-foreground text-xs shadow-2xs space-y-2">
              <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold">
                <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                <span>소희가 마케팅 계획을 세우고 실행 준비를 하고 있어요...</span>
              </div>
              {progressSteps.length > 0 ? (
                <AgentWorkStepTimeline steps={progressSteps} isRunning={isSubmitting} />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  화면 맥락을 확인하고 필요한 작업과 답변을 준비 중이에요.
                </p>
              )}
            </div>
          </div>
        )}
        {activityRecovery && (
          <section aria-label="활동 복구 상태" className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
            <p role="status">
              {activityRecovery.stopped
                ? '활동 조회를 멈췄어요. 결과는 잠시 후 확인해 주세요.'
                : activityRecovery.nextCheckAt === null
                  ? '조회가 완료되지 않았어요. 대화를 다시 열면 확인해요.'
                  : <>기존 작업 결과를 조회하고 있습니다. 다음 확인: <time dateTime={new Date(activityRecovery.nextCheckAt).toISOString()}>{new Date(activityRecovery.nextCheckAt).toLocaleTimeString('ko-KR', { hour12: false })}</time></>}
            </p>
            {activityRecovery.nextCheckAt !== null && (
              <>
                <p>화면 조회만 멈추며 진행 중인 작업은 유지돼요.</p>
                <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-foreground cursor-pointer" onClick={() => {
                  abortControllerRef.current?.abort();
                  activityRecoveryControllerRef.current?.abort();
                  setActivityRecovery({ nextCheckAt: null, stopped: true });
                }}>활동 조회 멈추기</button>
              </>
            )}
          </section>
        )}
        {taskTimeline && <ConversationTaskTimeline timeline={taskTimeline} defaultCollapsed />}
        <AgentActivityTimeline events={activityEvents} />
        <AgentReasonSummary events={activityEvents} />
        <div ref={messagesEndRef} />
      </div>
      {evidenceScope && <div className="min-w-0 min-h-0 max-h-48 overflow-y-auto border-t border-border p-3 @[800px]:max-h-none @[800px]:border-t-0 @[800px]:border-l">
        <MissionEvidenceRail workspaceId={workspaceId} missionId={evidenceScope.missionId!} runId={evidenceScope.actionRunId!} />
      </div>}
      </div>

      {autoSendWaiting && (
        <div role="status" className="px-3.5 py-1.5 text-[11px] font-medium text-purple-700 dark:text-purple-300 bg-purple-50/70 dark:bg-purple-950/40 border-t border-purple-200/60 dark:border-purple-900/40">
          소희와 연결하는 중이에요. 연결되면 바로 보낼게요.
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className={unseenActivities ? 'shrink-0 border-t border-border bg-card px-3' : 'sr-only'}>
        {unseenActivities > 0 && <button type="button" onClick={jumpToLatest} className="min-h-11 w-full text-xs font-semibold text-primary">새 활동 {unseenActivities}건</button>}
      </div>
      {/* Input Area */}
      <form
        onSubmit={handleSubmit}
        className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-border bg-card space-y-2 shrink-0 min-w-0"
      >
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium px-1">
          <span>
            소희 크레딧:{' '}
            {isCreditsLoading ? (
              <span className="text-muted-foreground font-medium">확인 중</span>
            ) : isCreditsError || capacity === 0 ? (
              <span className="text-muted-foreground font-medium">확인 불가</span>
            ) : (
              <strong className="text-purple-600 dark:text-purple-400 font-bold">
                {balance?.toLocaleString() ?? 0}
              </strong>
            )}
          </span>
          <span className="font-mono">단축키: ⌘K</span>
        </div>

        {/* 빠른 추천 프롬프트 칩 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="toolbar" aria-label="추천 프롬프트">
          {[
            { label: '📊 지난주 성과 요약', query: '지난주 성과 요약해줘' },
            { label: '✍️ 가을맞이 홍보글 작성', query: '가을맞이 1:1 맞춤 케어 인스타 홍보글 작성해줘' },
            { label: '📍 네이버 블로그 원고 작성', query: '네이버 블로그 원고 작성해줘' },
            { label: '⏸️ 소희 자율근무 제어', query: '소희 자율근무 상태 확인하고 제어해줘' },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSubmit(undefined, chip.query)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-border/80 bg-muted/40 hover:bg-muted text-foreground/80 hover:text-foreground shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="relative flex items-end gap-1.5 rounded-xl border border-border bg-background p-1.5 focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500 transition-all">
          <textarea
            ref={inputRef}
            aria-label="소희에게 보낼 메시지"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="예: 이번 주말 신메뉴 글 올려줘"
            className="min-w-0 flex-1 resize-none bg-transparent text-base md:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none p-1 leading-relaxed"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSubmitting}
            aria-label="소희에게 메시지 전송"
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* 1초 예약 확정 다이얼로그 (SNS 리드 ➡️ 매장 예약 전환) */}
      <ReservationDialog
        open={reservationDialogOpen}
        onClose={() => setReservationDialogOpen(false)}
        onConfirm={handleConfirmReservation}
        defaultCustomerName={reservationInitData?.customerName || ''}
        defaultSuggestedTime={reservationInitData?.suggestedTime || ''}
        defaultServiceName={reservationInitData?.serviceName || '1:1 맞춤 퍼스널 뷰티'}
        isSubmitting={isSubmittingReservation}
      />
    </aside>
  );
}
