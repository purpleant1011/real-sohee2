'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  ShieldAlert,
  Sliders,
  ChevronDown,
  Minimize2,
  Maximize2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useSurfaceContext, getRouteDisplayName } from '@/features/agent-dock/surface-context';
import { approvalWriteKind, useProposalBus } from '@/features/agent-dock/proposal-bus';
import { parseControlCommand } from '@/features/agent-dock/parse-control-command';
import { parseDockActions, type DockAction } from '@/features/agent-intent/dock-actions';
import { DockActionCard } from './dock-action-card';
import { SafeChatMarkdown } from '@/features/chat-floor/safe-markdown';
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy';
import { useCreditBalance } from '@/hooks/use-credit-balance';
import { useAgentSession } from '@/hooks/use-agent-session';
import { DockControlBar } from './dock-control-bar';
import { OwnerExceptionCard } from './owner-exception-card';
import { OwnerException, ProposalPayload } from '@/features/agent-dock/types';

import {
  PlanCard,
  ApprovalCard,
  LiveExecutionCard,
  EvidenceCard,
  BlockedCard,
  ResultUnknownCard,
} from './event-cards';
import {
  PlanCardData,
  LiveExecutionCardData,
  DecisionCardData,
  EvidenceResultCardData,
} from '@/lib/agent-os/agent-orchestrator';
import { AgentActivityTimeline } from '@/components/agent-activity/agent-activity-timeline';
import { AgentReasonSummary } from '@/components/agent-activity/agent-reason-summary';
import { AgentArtifactPlanCard } from '@/components/agent-activity/agent-artifact-plan-card';
import { projectActivityEvent, type AgentActivityEvent } from '@/features/agent-activity/activity-event';
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard';
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card';
import type { RecoveryView } from '@/features/booking-recovery/contracts';

export interface UniversalAgentDockProps {
  workspaceId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsible?: boolean;
  pendingExceptions?: OwnerException[];
}

export interface DockChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: string;
  isControlEvent?: boolean;
  actions?: DockAction[];
  suggestedQuestions?: string[];
  proposal?: ProposalPayload;
  planCard?: PlanCardData | null;
  liveExecutionCard?: LiveExecutionCardData | null;
  approvalCard?: DecisionCardData | null;
  evidenceResultCard?: EvidenceResultCardData | null;
  failureCard?: { errorCode: string; message: string; step: string } | null;
  recoveryCard?: RecoveryView | null;
  activityEvents?: AgentActivityEvent[];
  actionGraph?: any;
  step?: string;
  runId?: string;
}

const INITIAL_GREETING = `안녕하세요 사장님! 마케팅을 돕는 AI 직원 소희예요.
"신메뉴 글 올려줘"처럼 말씀하시면 초안을 제안해요. 최종 발행은 직접 확인 후 승인해 주세요.`;

export function UniversalAgentDock({
  workspaceId = 'ws-default',
  isOpen = true,
  onClose,
  isCollapsible = false,
  pendingExceptions = [],
}: UniversalAgentDockProps) {
  const { context, getSurfaceContextPrompt } = useSurfaceContext();
  const { sessionId, threadId } = useAgentSession(workspaceId);
  const { isRunning, actualMode, killSwitchActive, isLoading: autonomyLoading, setAutonomy } = useSoheeAutonomy(workspaceId);
  const { balance } = useCreditBalance(workspaceId);
  const { activeProposals, propose, acceptProposal, rejectProposal } = useProposalBus();
  const runExternalWrite = useExternalWriteGuard();

  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<DockChatMessage[]>([
    {
      id: 'msg-init',
      role: 'assistant',
      content: INITIAL_GREETING,
      timestamp: '방금 전',
    },
  ]);

  const [exceptions, setExceptions] = useState<OwnerException[]>(pendingExceptions);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  // Sync incoming pendingExceptions prop if provided
  useEffect(() => {
    if (pendingExceptions && pendingExceptions.length > 0) {
      setExceptions(pendingExceptions);
    }
  }, [pendingExceptions]);

  // Restore conversation history on mount or threadId change
  useEffect(() => {
    let isCancelled = false;
    const activeThreadId = threadId;
    if (!activeThreadId || !workspaceId) return;

    async function loadThreadHistory(tid: string) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat?threadId=${encodeURIComponent(tid)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isCancelled || !Array.isArray(data?.messages) || data.messages.length === 0) return;

        const loadedMessages: DockChatMessage[] = data.messages.map((m: any) => {
          const role: 'assistant' | 'user' | 'system' =
            m.role === 'sohee' || m.role === 'assistant'
              ? 'assistant'
              : m.role === 'user'
              ? 'user'
              : 'system';
          return {
            id: m.id || `hist-${Date.now()}-${Math.random()}`,
            role,
            content: m.content || '',
            timestamp: m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '이전 대화',
            isControlEvent: role === 'system',
            actions: parseDockActions(m.actions),
          };
        });

        if (loadedMessages.length > 0) {
          setMessages(loadedMessages);
        }
      } catch (err) {
        console.error('[UniversalAgentDock] Failed to restore thread history:', err);
      }
    }

    loadThreadHistory(activeThreadId);
    return () => {
      isCancelled = true;
    };
  }, [workspaceId, threadId]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom <= 60;
    setIsAtBottom(nearBottom);
    if (nearBottom) {
      setUnseenCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      messagesEndRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }
    setUnseenCount(0);
    setIsAtBottom(true);
  }, []);

  const prevMessagesCountRef = useRef(messages.length);

  // Scroll to bottom on new messages
  useEffect(() => {
    const prevCount = prevMessagesCountRef.current;
    const currentCount = messages.length;
    prevMessagesCountRef.current = currentCount;

    if (currentCount <= prevCount) {
      return;
    }

    const diff = currentCount - prevCount;

    if (isAtBottom) {
      if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
        const prefersReducedMotion =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        messagesEndRef.current.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        });
      }
    } else {
      setUnseenCount((prev) => prev + diff);
    }
  }, [messages, isAtBottom]);

  // Keyboard shortcut: Cmd+K / Ctrl+K to focus input or toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Emergency stop handler invoking Kill Switch endpoint directly
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

  // Pause handler
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

  // Resume handler
  const handleResume = useCallback(async () => {
    // If kill switch was on, turn it off first
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

  // Proposal approval handler
  const handleApproveProposal = useCallback(
    async (proposalId: string) => {
      const ok = await acceptProposal(proposalId);
      if (ok) {
        setExceptions((prev) =>
          prev.map((ex) =>
            ex.proposal?.id === proposalId
              ? { ...ex, proposal: { ...ex.proposal, status: 'ACCEPTED' } }
              : ex
          )
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `prop-ok-${Date.now()}`,
            role: 'assistant',
            content: '✅ 승인하신 내용이 설정에 반영되었습니다.',
            timestamp: '방금 전',
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `prop-err-${Date.now()}`,
            role: 'assistant',
            content: '⚠️ 승인 처리에 실패했어요. 다시 시도해 주세요.',
            timestamp: '방금 전',
          },
        ]);
      }
    },
    [acceptProposal]
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
        setMessages((prev) => [
          ...prev,
          {
            id: `prop-rej-${Date.now()}`,
            role: 'assistant',
            content: '❌ 사장님의 거절에 따라 제안이 반려되었습니다.',
            timestamp: '방금 전',
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `prop-rej-err-${Date.now()}`,
            role: 'assistant',
            content: '⚠️ 제안 거절 처리에 실패했습니다.',
            timestamp: '방금 전',
          },
        ]);
      }
    },
    [rejectProposal]
  );

  const handleDismissException = useCallback((exceptionId: string) => {
    setExceptions((prev) => prev.filter((e) => e.id !== exceptionId));
  }, []);

  // Handle structured ApprovalCard approval (ANI-921, ANI-939)
  const handleApproveDecision = useCallback(
    async (decisionId: string, optionId?: string) => {
      const approveDecision = async () => {
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proposalId: decisionId,
              action: 'APPROVE',
              optionId,
            }),
          });

          if (res.ok) {
            const resData = await res.json();
            // Dispatch Same Truth patch event to central workbench
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('SOHEE_WORKBENCH_PATCH', {
                  detail: {
                    actionRunId: resData.approval?.actionRunId,
                    workspaceId,
                    action: 'APPROVE',
                    executionResult: resData.executionResult,
                  },
                })
              );
            }

            setMessages((prev) => [
              ...prev,
              {
                id: `asst-appr-${Date.now()}`,
                role: 'assistant',
                content: '✅ 사장님의 승인에 따라 실행이 즉시 완료되었습니다.',
                timestamp: '방금 전',
                evidenceResultCard: resData.executionResult?.evidence || {
                  settledSC: 150,
                  verifiedUrls: [],
                },
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `asst-err-${Date.now()}`,
                role: 'assistant',
                content: '⚠️ 승인 처리 중 오류가 발생했습니다.',
                timestamp: '방금 전',
              },
            ]);
          }
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: `asst-err-${Date.now()}`,
              role: 'assistant',
              content: '⚠️ 승인 네트워크 통신 오류입니다.',
              timestamp: '방금 전',
            },
          ]);
        }
      };

      // 승인은 서버에서 발송·게시·예약 같은 외부 쓰기를 실행한다. 오프라인이거나 같은 승인이 이미
      // 진행 중이면 요청을 내보내지 않는다(ANI-1725). 막히면 예외로 올려 승인 카드가 FAILED 와
      // 그 이유를 그리게 한다 — 승인 완료로 보이면 안 된다.
      const outcome = await runExternalWrite(approvalWriteKind(), decisionId, approveDecision);
      if (!outcome.ran) throw new Error(outcome.decision.message);
      return outcome.value;
    },
    [workspaceId, runExternalWrite]
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

        if (res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: `asst-rej-${Date.now()}`,
              role: 'assistant',
              content: '❌ 사장님의 거절에 따라 작업이 안전하게 취소되었습니다.',
              timestamp: '방금 전',
            },
          ]);
        }
      } catch {}
    },
    [workspaceId]
  );

  // Send message handler with Natural Language Command Parsing (ANI-809 Same Truth)
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = input.trim();
    if (!query || isSubmitting) return;

    setInput('');
    const clientMessageId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `msg-${Date.now()}`;

    const userMessage: DockChatMessage = {
      id: clientMessageId,
      role: 'user',
      content: query,
      timestamp: '방금 전',
    };

    setMessages((prev) => [...prev, userMessage]);

    // 1. Check if the message is a Natural Language Control Command
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

    // 예약 문의 회수 인터셉트 (다수 건 모호성 방지 및 1건 시 직접 렌더)
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
              content: '💌 확인이 필요한 예약 문의예요.',
              timestamp: '방금 전',
              recoveryCard: singleCase,
            },
          ]);
        } else {
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

    // 2. Otherwise, treat as conversational/marketing instruction
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          threadId,
          message: query,
          currentUserMessage: query,
          clientMessageId,
          dockIntent: true,
          surfaceContext: context,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const replyText =
          data?.reply ||
          data?.content ||
          (data?.step === 'BLOCKED'
            ? '⚠️ 실행 조건이 충족되지 않아 중단되었습니다.'
            : '⚠️ 응답 내용이 비어 있습니다. 잠시 후 다시 시도해 주세요.');

        const parsedActivities: AgentActivityEvent[] = Array.isArray(data?.activityEvents)
          ? data.activityEvents
              .map((item: unknown) => projectActivityEvent(item))
              .filter((ev: AgentActivityEvent | null): ev is AgentActivityEvent => ev !== null)
          : Array.isArray(data?.activities)
          ? data.activities
              .map((item: unknown) => projectActivityEvent(item))
              .filter((ev: AgentActivityEvent | null): ev is AgentActivityEvent => ev !== null)
          : [];

        const newMsg: DockChatMessage = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: replyText,
          timestamp: '방금 전',
          actions: parseDockActions(data?.actions),
          suggestedQuestions: Array.isArray(data?.suggestedQuestions) ? data.suggestedQuestions.slice(0, 3) : [],
          planCard: data?.planCard,
          liveExecutionCard: data?.liveExecutionCard,
          approvalCard: data?.approvalCard,
          evidenceResultCard: data?.evidenceResultCard,
          failureCard: data?.failureCard,
          activityEvents: parsedActivities.length > 0 ? parsedActivities : undefined,
          actionGraph: data?.actionGraph,
          step: data?.step,
          runId: data?.runId,
        };

        setMessages((prev) => [...prev, newMsg]);

        // Same Truth Workbench Patch Event (ANI-921)
        if (data?.runId && (data?.step === 'MCP_TOOL_EXECUTED' || data?.evidenceResultCard)) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('SOHEE_WORKBENCH_PATCH', {
                detail: {
                  actionRunId: data.runId,
                  workspaceId,
                  step: data.step,
                  settledSC: data.evidenceResultCard?.settledSC,
                },
              })
            );
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const errReason = res.status === 401 || res.status === 403
          ? '권한을 확인하지 못했어요. 다시 로그인해 주세요.'
          : typeof errData?.content === 'string' && res.status === 400
            ? errData.content
            : '답변을 가져오지 못했어요. 잠시 후 다시 시도할게요.';
        setMessages((prev) => [
          ...prev,
          {
            id: `asst-err-${Date.now()}`,
            role: 'assistant',
            content: errReason,
            timestamp: '방금 전',
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-neterr-${Date.now()}`,
          role: 'assistant',
          content: '연결이 끊겨 답변을 받지 못했어요. 잠시 후 다시 시도할게요.',
          timestamp: '방금 전',
        },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      data-testid="universal-agent-dock"
      aria-label="소희 자율 에이전트 도크"
      className="w-full md:w-96 h-full flex flex-col bg-card border-l border-border select-text shrink-0 z-30 shadow-lg md:shadow-none"
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
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                Dock
              </span>
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
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              aria-label="도크 닫기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Exclusive Status Control Bar (Figma 9:703 & ANI-809) */}
      <DockControlBar
        actualMode={actualMode}
        isRunning={isRunning}
        killSwitchActive={killSwitchActive}
        isLoading={autonomyLoading}
        onPause={handlePause}
        onResume={handleResume}
        onEmergencyStop={handleEmergencyStop}
      />

      {/* Exception & Escalation Cards (Human-in-the-loop) */}
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

      {/* Messages Scroll Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-3.5 overflow-y-auto space-y-3 min-h-0 bg-background/50 relative"
      >
        {messages.map((msg) => {
          if (msg.isControlEvent) {
            return (
              <div
                key={msg.id}
                className="py-1.5 px-3 rounded-lg bg-muted/70 border border-border/60 text-xs text-muted-foreground font-semibold text-center my-1"
              >
                {msg.content}
              </div>
            );
          }

          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-950 flex items-center justify-center text-purple-700 dark:text-purple-300 shrink-0 text-xs font-bold mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs ${
                  isUser
                    ? 'bg-purple-600 text-white rounded-br-xs font-medium'
                    : 'bg-card border border-border/80 text-foreground rounded-bl-xs'
                }`}
              >
                {isUser ? <p className="whitespace-pre-wrap">{msg.content}</p> : <SafeChatMarkdown content={msg.content} />}
                {!isUser && msg.suggestedQuestions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5" aria-label="추천 질문">
                    {msg.suggestedQuestions.map((question) => (
                      <button key={question} type="button" onClick={() => { setInput(question); inputRef.current?.focus(); }}
                        className="rounded-full border border-border px-2.5 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600">
                        {question}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Structured Event Cards (ANI-921) */}
                {!isUser && (
                  <div className="mt-2 space-y-1.5">
                    {msg.actions && msg.actions.length > 0 && <DockActionCard workspaceId={workspaceId} actions={msg.actions} />}
                    {msg.planCard && <AgentArtifactPlanCard plan={msg.planCard} workspaceId={workspaceId} runId={msg.runId} />}
                    {msg.activityEvents && msg.activityEvents.length > 0 && (
                      <div className="space-y-2">
                        <AgentActivityTimeline
                          events={msg.activityEvents}
                          filterWorkspaceId={workspaceId}
                          filterRunId={msg.runId}
                        />
                        <AgentReasonSummary
                          events={msg.activityEvents}
                          filterWorkspaceId={workspaceId}
                          filterRunId={msg.runId}
                        />
                      </div>
                    )}
                    {msg.liveExecutionCard && <LiveExecutionCard card={msg.liveExecutionCard} />}
                    {msg.approvalCard && (
                      <ApprovalCard
                        card={msg.approvalCard}
                        onApprove={handleApproveDecision}
                        onReject={handleRejectDecision}
                      />
                    )}
                    {msg.evidenceResultCard && (
                      <EvidenceCard
                        evidence={msg.evidenceResultCard}
                        onNavigate={(url) => {
                          if (typeof window !== 'undefined') window.location.href = url;
                        }}
                      />
                    )}
                    {msg.failureCard && (
                      <BlockedCard
                        errorCode={msg.failureCard.errorCode}
                        message={msg.failureCard.message}
                        step={msg.failureCard.step}
                      />
                    )}
                    {msg.recoveryCard && (
                      <div className="mt-2">
                        <RecoveryCard
                          view={msg.recoveryCard}
                          onCommand={async (cmd) => {
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
                            // 회수 명령 중 외부로 나가는 두 가지(답변 전송 승인·예약 확정 승인)만 가드한다.
                            // 막히면 이유를 예외로 올려 카드의 role="alert" 에 그대로 보여 준다 — 거짓 성공 금지.
                            const kind = cmd.kind === 'approve_send' ? ('send' as const)
                              : cmd.kind === 'approve_booking' ? ('reservation' as const) : null;
                            if (!kind) return submit();
                            const outcome = await runExternalWrite(kind, `recovery:${msg.recoveryCard!.caseId}`, submit);
                            if (!outcome.ran) throw new Error(outcome.decision.message);
                            return outcome.value;
                          }}
                        />
                      </div>
                    )}
                    {msg.step === 'BLOCKED' && !msg.failureCard && (
                      <BlockedCard
                        errorCode="BLOCKED_BY_POLICY"
                        message="실행 정책 및 조건 미충족으로 중단되었습니다."
                      />
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
              </div>
              {isUser && (
                <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0 text-xs font-bold mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
        {!isAtBottom && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none z-20">
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="최신 활동으로 이동"
              className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full border border-purple-300 bg-background/95 px-4 py-2 text-xs font-semibold text-purple-700 shadow-md backdrop-blur-xs transition hover:bg-muted active:scale-95 dark:border-purple-800 dark:text-purple-300"
            >
              <ChevronDown className="size-4" />
              <span>최신 활동으로 이동</span>
              {unseenCount > 0 && (
                <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] text-white">
                  +{unseenCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-border bg-card space-y-2 shrink-0"
      >
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium px-1">
          <span>
            소희 크레딧: <strong className="text-purple-600 dark:text-purple-400 font-bold">{balance?.toLocaleString() ?? 0}</strong>
          </span>
          <span className="font-mono">단축키: ⌘K</span>
        </div>

        <div className="relative flex items-end gap-1.5 rounded-xl border border-border bg-background p-1.5 focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500 transition-all">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="예: 이번 주말 신메뉴 글 올려줘"
            className="flex-1 resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none p-1 leading-relaxed"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSubmitting}
            aria-label="소희에게 메시지 전송"
            className="p-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
