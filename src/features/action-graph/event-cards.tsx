'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Compass,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ArrowUpRight,
  Ban,
  Check,
  X,
  Loader2,
  Sparkles,
  Target,
  FileCheck2,
  Receipt,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  GitBranch,
} from 'lucide-react';
import {
  PlanCardData,
  LiveExecutionCardData,
  DecisionCardData,
  EvidenceResultCardData,
} from '@/lib/agent-os/agent-orchestrator';

// ==========================================
// 1. GoalCard (목표 및 정규화 의도 카드)
// ==========================================
export interface GoalCardProps {
  goalId?: string;
  userGoal: string;
  normalizedIntent?: string;
  intentCategory?: string;
  parameters?: Record<string, unknown>;
  status?: 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | string;
  createdAt?: string;
}

export function GoalCard({
  goalId,
  userGoal,
  normalizedIntent,
  intentCategory = 'CAMPAIGN',
  parameters,
  status = 'ACCEPTED',
}: GoalCardProps) {
  return (
    <div
      data-testid="event-card-goal"
      className="p-3 rounded-xl border border-primary/30 bg-primary/10 text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-primary" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-foreground">
            GOAL
          </span>
          {intentCategory && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              {intentCategory}
            </span>
          )}
        </div>
        {goalId && (
          <span className="text-[9px] font-mono text-muted-foreground">{goalId}</span>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-medium text-foreground">
          <span className="text-[10px] font-bold text-primary block mb-0.5">
            사장님 지시 목표:
          </span>
          <p className="bg-background/70 p-1.5 rounded-md border border-primary/15">
            {userGoal}
          </p>
        </div>

        {normalizedIntent && (
          <div className="text-[11px] font-medium text-foreground pt-0.5">
            <span className="text-[10px] font-bold text-muted-foreground block mb-0.5">
              정규화된 실행 의도:
            </span>
            <p className="bg-background/80 p-1.5 rounded-md border border-border font-mono text-[10px] text-primary">
              {normalizedIntent}
            </p>
          </div>
        )}
      </div>

      {parameters && Object.keys(parameters).length > 0 && (
        <div className="pt-1 border-t border-primary/50 text-[10px] text-muted-foreground flex flex-wrap gap-1">
          {Object.entries(parameters).map(([key, val]) => (
            <span key={key} className="px-1.5 py-0.5 bg-background/90 rounded border border-border">
              {key}: <strong className="text-foreground">{String(val)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. PlanCard (계획 수립 및 종속성 그래프 카드)
// ==========================================
export interface PlanCardNode {
  id?: string;
  name: string;
  sc?: number;
  risk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  status?: string;
  dependencies?: string[];
}

export interface PlanCardProps {
  plan: PlanCardData & {
    dependencies?: Array<{ from: string; to: string }>;
    nodes?: PlanCardNode[];
  };
}

export function PlanCard({ plan }: PlanCardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayTitle = plan.title
    ? /\b[a-z0-9_]+(?:\.[a-z0-9_]+)+\b/i.test(plan.title)
      ? '작업 계획'
      : plan.title
    : '다단계 실행 계획';

  return (
    <div
      data-testid="event-card-plan"
      className="p-3 rounded-xl border border-state-wait/30 bg-state-wait-soft text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-state-wait" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-wait-soft text-state-wait ">
            계획
          </span>
          <span className="font-bold text-foreground truncate max-w-[180px]">
            {displayTitle}
          </span>
        </div>
        <span className="text-[10px] font-mono font-semibold text-state-wait">
          총 {plan.totalSC || 0} 크레딧
        </span>
      </div>

      {plan.requiresApproval && (
        <div className="flex items-center gap-1 text-[10px] text-state-warn bg-state-warn-soft px-2 py-0.5 rounded font-medium">
          <AlertTriangle className="w-3 h-3 text-state-warn shrink-0" />
          <span>실행 전 사장님의 사전 승인이 필요한 계획입니다.</span>
        </div>
      )}

      {/* Plan Steps */}
      {plan.steps && plan.steps.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-state-wait/50">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
            <span>실행 단계 ({plan.steps.length}단계)</span>
            {plan.steps.length > 2 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-0.5 text-state-wait hover:underline cursor-pointer"
              >
                {expanded ? '접기' : '전체보기'}
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          <div className="space-y-1">
            {(expanded ? plan.steps : plan.steps.slice(0, 2)).map((step, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-0.5 px-1.5 rounded bg-background/60 text-[11px]"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-4 h-4 rounded-full bg-state-wait/20 text-state-wait text-[9px] font-mono flex items-center justify-center font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <span className="truncate text-foreground font-medium">{step.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className={`text-[9px] font-bold px-1 rounded ${
                      step.risk === 'HIGH' || step.risk === 'CRITICAL'
                        ? 'bg-state-danger-soft text-state-danger '
                        : step.risk === 'MEDIUM'
                        ? 'bg-state-warn-soft text-state-warn '
                        : 'bg-state-ok-soft text-state-ok '
                    }`}
                  >
                    {step.riskLabel || (step.risk === 'LOW' ? '안전' : step.risk === 'MEDIUM' ? '주의' : (step.risk === 'HIGH' || step.risk === 'CRITICAL') ? '확인 필요' : '안전')}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">{step.sc} 크레딧</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies Graph View */}
      {plan.dependencies && plan.dependencies.length > 0 && (
        <div className="pt-1 border-t border-state-wait/40 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1 font-semibold mb-1">
            <GitBranch className="w-3 h-3 text-state-wait" />
            <span>단계 간 의존성 (Dependencies)</span>
          </div>
          <div className="flex flex-wrap gap-1 font-mono text-[9px]">
            {plan.dependencies.map((dep, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-background/80 rounded border border-state-wait/60 text-state-wait">
                {dep.from} &rarr; {dep.to}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 3. ApprovalCard (결정 및 승인 카드 - CAS & Diff)
// ==========================================
export type ApprovalServerStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'REJECTED'
  | 'VERSION_CONFLICT'
  | 'EXPIRED'
  | 'FAILED';

export interface ApprovalCardProps {
  card: DecisionCardData & {
    expectedVersion?: number | string;
    diff?: {
      before?: Record<string, unknown> | string;
      after?: Record<string, unknown> | string;
    } | string;
    diffSummary?: string;
    actionRunId?: string;
    serverStatus?: ApprovalServerStatus;
    status?: ApprovalServerStatus | string;
    errorMessage?: string;
  };
  onApprove?: (
    decisionId: string,
    optionId?: string
  ) => Promise<{ success: boolean; status?: ApprovalServerStatus; error?: string } | void> | void;
  onReject?: (
    decisionId: string
  ) => Promise<{ success: boolean; status?: ApprovalServerStatus; error?: string } | void> | void;
  onRetry?: (decisionId: string) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  isProcessing?: boolean;
  serverStatus?: ApprovalServerStatus;
  errorMessage?: string;
}

export function ApprovalCard({
  card,
  onApprove,
  onReject,
  onRetry,
  onRefresh,
  isProcessing = false,
  serverStatus,
  errorMessage,
}: ApprovalCardProps) {
  const getAuthoritativeStatus = (): ApprovalServerStatus | undefined => {
    if (serverStatus) return serverStatus;
    if (card.serverStatus) return card.serverStatus as ApprovalServerStatus;
    if (card.status && ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'VERSION_CONFLICT', 'EXPIRED', 'FAILED'].includes(card.status)) {
      return card.status as ApprovalServerStatus;
    }
    return undefined;
  };

  const authoritativeStatus = getAuthoritativeStatus();
  const [localStatus, setLocalStatus] = useState<ApprovalServerStatus>(authoritativeStatus || 'PENDING');
  const [localError, setLocalError] = useState<string | null>(errorMessage || card.errorMessage || null);
  const [internalProcessing, setInternalProcessing] = useState(false);

  React.useEffect(() => {
    const authStatus = getAuthoritativeStatus();
    if (authStatus) {
      setLocalStatus(authStatus);
    }
  }, [serverStatus, card.serverStatus, card.status]);

  React.useEffect(() => {
    if (errorMessage || card.errorMessage) {
      setLocalError(errorMessage || card.errorMessage || null);
    }
  }, [errorMessage, card.errorMessage]);

  const effectiveStatus = authoritativeStatus || localStatus;
  const processing = isProcessing || internalProcessing || effectiveStatus === 'PROCESSING';

  const handleApprove = async (optionId?: string) => {
    if (processing || effectiveStatus === 'APPROVED' || effectiveStatus === 'REJECTED') return;

    setInternalProcessing(true);
    setLocalStatus('PROCESSING');
    setLocalError(null);

    try {
      if (onApprove) {
        const res = await onApprove(card.decisionId, optionId);
        if (res && typeof res === 'object') {
          if (res.success === false || (res.status && res.status !== 'APPROVED')) {
            const nextStatus = (res.status || 'FAILED') as ApprovalServerStatus;
            setLocalStatus(nextStatus);
            if (res.error) setLocalError(res.error);
            return;
          }
        }
      }
      setLocalStatus('APPROVED');
    } catch (err: any) {
      const msg = err?.message || String(err || '');
      const code = err?.code || '';
      if (code === 'VERSION_CONFLICT' || /conflict|VERSION_CONFLICT/i.test(msg)) {
        setLocalStatus('VERSION_CONFLICT');
        setLocalError(msg || '버전 충돌: 다른 작업에 의해 상태가 이미 변경되었습니다.');
      } else if (code === 'EXPIRED' || /expired|EXPIRED/i.test(msg)) {
        setLocalStatus('EXPIRED');
        setLocalError(msg || '승인 기한 만료: 유효 시간이 초과되었습니다.');
      } else {
        setLocalStatus('FAILED');
        setLocalError(msg || '승인 처리 실패: 서버에서 오류가 발생했습니다.');
      }
    } finally {
      setInternalProcessing(false);
    }
  };

  const handleReject = async () => {
    if (processing || effectiveStatus === 'APPROVED' || effectiveStatus === 'REJECTED') return;

    setInternalProcessing(true);
    setLocalStatus('PROCESSING');
    setLocalError(null);

    try {
      if (onReject) {
        const res = await onReject(card.decisionId);
        if (res && typeof res === 'object' && res.success === false) {
          setLocalStatus((res.status || 'FAILED') as ApprovalServerStatus);
          if (res.error) setLocalError(res.error);
          return;
        }
      }
      setLocalStatus('REJECTED');
    } catch (err: any) {
      const msg = err?.message || String(err || '');
      setLocalStatus('FAILED');
      setLocalError(msg || '반려 처리 실패: 서버에서 오류가 발생했습니다.');
    } finally {
      setInternalProcessing(false);
    }
  };

  const handleRetry = async () => {
    if (onRetry) {
      await onRetry(card.decisionId);
    } else {
      await handleApprove(card.options?.[0]?.id);
    }
  };

  return (
    <div
      data-testid="event-card-approval"
      className="p-3 rounded-xl border border-state-warn/40 bg-state-warn-soft text-xs space-y-2.5 transition-all my-1.5 shadow-2xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-state-warn" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-warn/20 text-state-warn ">
            APPROVAL_REQUIRED
          </span>
          {card.expectedVersion !== undefined && (
            <span className="text-[9px] font-mono font-bold px-1 rounded bg-state-warn-soft text-state-warn">
              CAS v{card.expectedVersion}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          {card.decisionId}
        </span>
      </div>

      <div>
        <h4 className="font-bold text-foreground text-xs leading-snug">{card.title}</h4>
      </div>

      {/* CAS Expected Version and Diff Representation */}
      {(card.diffSummary || card.diff) && (
        <div className="p-2 rounded-lg bg-background/80 border border-state-warn/80 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-state-warn">
            <span>변경사항 (Diff)</span>
            {card.expectedVersion !== undefined && (
              <span className="font-mono text-[9px] text-muted-foreground">expectedVersion: {card.expectedVersion}</span>
            )}
          </div>
          {card.diffSummary && (
            <p className="text-[10px] font-medium text-foreground leading-relaxed">{card.diffSummary}</p>
          )}
          {typeof card.diff === 'object' && card.diff !== null && (
            <div className="font-mono text-[9px] space-y-0.5 pt-1 text-muted-foreground">
              {card.diff.before && (
                <div className="text-state-danger truncate">
                  - Before: {JSON.stringify(card.diff.before)}
                </div>
              )}
              {card.diff.after && (
                <div className="text-state-ok truncate">
                  + After: {JSON.stringify(card.diff.after)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Options if provided */}
      {card.options && card.options.length > 0 && (
        <div className="space-y-1.5">
          {card.options.map((opt) => (
            <div
              key={opt.id}
              className="p-2 rounded-lg bg-background/80 border border-state-warn/60 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[11px] text-foreground">{opt.label}</span>
                {opt.sc !== undefined && (
                  <span className="text-[10px] font-mono font-bold text-primary">
                    {opt.sc} 크레딧
                  </span>
                )}
              </div>
              {opt.description && (
                <p className="text-[10px] text-muted-foreground leading-relaxed">{opt.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action / Resolution Status */}
      {effectiveStatus === 'PROCESSING' || (processing && effectiveStatus === 'PENDING') ? (
        <div
          data-testid="approval-status-processing"
          className="flex items-center gap-2 text-state-warn font-bold text-xs py-1.5 px-2 rounded-lg bg-state-warn-soft border border-state-warn/40"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin text-state-warn" />
          <span>서버 승인 처리 중... (ActionRun 상태 전이 대기)</span>
        </div>
      ) : effectiveStatus === 'VERSION_CONFLICT' ? (
        <div
          data-testid="approval-status-conflict"
          className="p-2.5 rounded-lg bg-state-danger-soft border border-state-danger/30 space-y-2 text-state-danger"
        >
          <div className="flex items-center gap-1.5 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-state-danger shrink-0" />
            <span>버전 충돌 (VERSION_CONFLICT): 이미 다른 세션에 의해 승인/수정되었거나 최신 버전이 아닙니다.</span>
          </div>
          {localError && (
            <p className="text-[11px] text-state-danger pl-5.5 font-medium">{localError}</p>
          )}
          <div className="flex items-center gap-2 pl-5.5 pt-1">
            <button
              type="button"
              onClick={() => (onRefresh ? onRefresh() : (typeof window !== 'undefined' ? window.location.reload() : undefined))}
              className="px-2.5 py-1 rounded-md bg-state-danger hover:bg-state-danger/90 text-state-danger-soft font-bold text-[11px] flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              최신 상태 새로고침
            </button>
          </div>
        </div>
      ) : effectiveStatus === 'EXPIRED' ? (
        <div
          data-testid="approval-status-expired"
          className="p-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 space-y-1.5 text-zinc-700 dark:text-zinc-300"
        >
          <div className="flex items-center gap-1.5 font-bold text-xs">
            <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>승인 기한 만료 (EXPIRED): 유효 시간이 초과된 요청입니다.</span>
          </div>
          {localError && <p className="text-[11px] text-zinc-600 dark:text-zinc-400 pl-5.5">{localError}</p>}
        </div>
      ) : effectiveStatus === 'FAILED' ? (
        <div
          data-testid="approval-status-failed"
          className="p-2.5 rounded-lg bg-state-danger-soft border border-state-danger/30 space-y-2 text-state-danger"
        >
          <div className="flex items-center gap-1.5 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-state-danger shrink-0" />
            <span>승인 처리 실패 (FAILED): 서버에서 처리를 완료하지 못했습니다.</span>
          </div>
          {localError && (
            <p className="text-[11px] text-state-danger pl-5.5 font-medium">{localError}</p>
          )}
          <div className="flex items-center gap-2 pl-5.5 pt-1">
            <button
              type="button"
              onClick={handleRetry}
              disabled={processing}
              className="px-2.5 py-1 rounded-md bg-state-danger hover:bg-state-danger/90 text-state-danger-soft font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              다시 시도
            </button>
          </div>
        </div>
      ) : effectiveStatus === 'APPROVED' ? (
        <div
          data-testid="approval-status-approved"
          className="flex items-center gap-1.5 text-state-ok font-bold text-xs py-1"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
          <span>승인 완료: 실행 결과는 별도로 확인해야 합니다.</span>
        </div>
      ) : effectiveStatus === 'REJECTED' ? (
        <div
          data-testid="approval-status-rejected"
          className="flex items-center gap-1.5 text-state-danger font-bold text-xs py-1"
        >
          <Ban className="w-3.5 h-3.5 text-state-danger" />
          <span>반려됨: 작업이 취소되었습니다.</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={processing}
            onClick={() => handleApprove(card.options?.[0]?.id)}
            className="flex-1 py-1.5 px-2.5 rounded-lg bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
          >
            {processing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            승인 및 실행
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={handleReject}
            className="py-1.5 px-3 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground font-semibold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-3 h-3" />
            반려
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 4. ExecutionCard (실시간 실행 및 디스패치 카드)
// ==========================================
export function mapActionRunStatusToKorean(status?: string): string {
  if (!status) return '확인 중';
  const s = status.trim().toUpperCase();
  switch (s) {
    case 'COMPLETED':
    case 'SUCCESS':
    case 'MCP_TOOL_EXECUTED':
      return '완료';
    case 'RUNNING':
    case 'EXECUTING':
    case 'IN_PROGRESS':
      return '진행 중';
    case 'AWAITING_APPROVAL':
    case 'APPROVAL_REQUIRED':
    case 'PENDING_APPROVAL':
      return '승인 기다리는 중';
    case 'BLOCKED':
      return '멈춤';
    case 'FAILED':
    case 'FAILURE':
    case 'ERROR':
      return '실패';
    case 'PLANNING':
    case 'PLAN':
      return '계획 중';
    case 'CONTENT_PREVIEW':
      return '미리보기 준비됨';
    case 'INTERVIEW_QUESTION':
      return '질문 드리는 중';
    default:
      return '확인 중';
  }
}

export interface ExecutionCardProps {
  card: LiveExecutionCardData & {
    dispatchStatus?: string;
    toolName?: string;
    actionRunId?: string;
  };
}

export function ExecutionCard({ card }: ExecutionCardProps) {
  const isCompleted = card.status === 'COMPLETED';
  const isFailed = card.status === 'FAILED';
  const statusLabel = mapActionRunStatusToKorean(card.dispatchStatus || card.status || 'EXECUTING');

  const cleanStepName = (card.currentStepName || '도구 실행 중...')
    .replace(/\s*\((COMPLETED|RUNNING|FAILED|EXECUTING|BLOCKED|AWAITING_APPROVAL)\)/g, '')
    .trim();

  // 내부 로그성 줄(실행 모드, [Iteration …], 영문 코드 나열, UUID 등) 필터링
  const userLogs = (card.logs || []).filter((log) => {
    if (!log) return false;
    if (/\[Iteration\s*\d+\]/i.test(log)) return false;
    if (/실행\s*모드/i.test(log)) return false;
    if (/서피스|활성\s*도구|동적\s*역량\s*디스커버리/i.test(log)) return false;
    if (/DRAFT|AUTONOMOUS|EXECUTION_MODE/i.test(log)) return false;
    if (/계약\s*충족|도구\s*호출\s*없이/i.test(log)) return false;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(log)) return false;
    if (/^(?:COMPLETED|RUNNING|EXECUTING|FAILED|BLOCKED|AWAITING_APPROVAL|GENERAL_REPLY)\b/i.test(log.trim())) return false;
    if (/^\[(?:TIMEOUT|ABORTED|MODEL_ERROR|FAILED|AWAITING_APPROVAL|BLOCKED)\]/i.test(log.trim())) return false;
    return true;
  });

  return (
    <div
      data-testid="event-card-execution"
      className="p-3 rounded-xl border border-state-wait/30 bg-state-wait-soft text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
          ) : isFailed ? (
            <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 text-state-wait animate-spin" />
          )}
          <span
            className={`font-extrabold text-[10px] px-1.5 py-0.5 rounded ${
              isCompleted
                ? 'bg-state-ok-soft text-state-ok '
                : isFailed
                ? 'bg-state-danger-soft text-state-danger '
                : 'bg-state-wait-soft text-state-wait '
            }`}
          >
            {statusLabel}
          </span>
          {card.dispatchStatus && <span className="sr-only">{card.dispatchStatus}</span>}
          <span className="font-bold text-foreground truncate max-w-[160px]">
            {cleanStepName || '도구 실행 중...'}
          </span>
        </div>
        <span className="text-[10px] font-mono font-bold text-state-wait">
          {card.progressPercentage || 0}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-state-wait-soft h-1.5 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isCompleted ? 'bg-state-ok' : isFailed ? 'bg-state-danger' : 'bg-state-wait'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, card.progressPercentage || 0))}%` }}
        />
      </div>

      {/* Logs summary if any */}
      {userLogs.length > 0 && (
        <div className="bg-background/80 rounded p-1.5 font-mono text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
          {userLogs.slice(-3).map((log, i) => (
            <div key={i} className="truncate">
              &gt; {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const LiveExecutionCard = ExecutionCard;
export type LiveExecutionCardProps = ExecutionCardProps;

// ==========================================
// 5. ProviderAcceptedCard (프로바이더 수신 영수증 카드)
// ==========================================
export interface ProviderAcceptedCardProps {
  providerReference: string;
  providerId?: string;
  actionRunId?: string;
  acceptedAt?: string;
  message?: string;
  status?: string;
}

export function ProviderAcceptedCard({
  providerReference,
  providerId = 'EXTERNAL_PROVIDER',
  actionRunId,
  acceptedAt,
  message = '외부 플랫폼이 요청을 정상 수신하여 영수증을 발급했습니다.',
  status = 'ACCEPTED',
}: ProviderAcceptedCardProps) {
  return (
    <div
      data-testid="event-card-provider-accepted"
      className="p-3 rounded-xl border border-state-wait/30 bg-state-wait-soft text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FileCheck2 className="w-3.5 h-3.5 text-state-wait" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-wait-soft text-state-wait ">
            플랫폼 접수 · 게시 확인 전
          </span>
          <span className="font-bold text-[10px] px-1 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            {providerId}
          </span>
        </div>
        {acceptedAt && (
          <span className="text-[9px] text-muted-foreground font-mono">
            {new Date(acceptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="bg-background/80 p-2 rounded-lg border border-state-wait/15 space-y-1">
        <div className="text-[10px] text-muted-foreground">프로바이더 접수 영수증 번호:</div>
        <div className="font-mono text-[11px] font-bold text-state-wait break-all select-all">
          {providerReference}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {message}
      </p>

      {actionRunId && (
        <div className="text-[9px] font-mono text-muted-foreground">
          ActionRun: {actionRunId}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 6. VerificationCard (독립 리드백 상태 검증 카드)
// ==========================================
export interface VerificationCardProps {
  verificationId?: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string;
  targetChannel?: string;
  targetUrl?: string;
  readbackResult?: string;
  isIndependentReadback?: boolean;
  verifiedAt?: string;
}

export function VerificationCard({
  verificationId,
  status,
  targetChannel,
  targetUrl,
  readbackResult,
  isIndependentReadback = true,
  verifiedAt,
}: VerificationCardProps) {
  const isCompleted = status === 'COMPLETED';
  const isInProgress = status === 'IN_PROGRESS';
  const isFailed = status === 'FAILED';

  return (
    <div
      data-testid="event-card-verification"
      className="p-3 rounded-xl border border-state-ok/30 bg-state-ok-soft text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-state-ok" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-ok-soft text-state-ok ">
            VERIFICATION
          </span>
          {isIndependentReadback && (
            <span className="text-[9px] font-bold px-1 rounded bg-state-ok-soft text-state-ok ">
              독립 리드백
            </span>
          )}
        </div>
        {verificationId && (
          <span className="text-[9px] font-mono text-muted-foreground">{verificationId}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {isInProgress ? (
          <Loader2 className="w-3.5 h-3.5 text-state-ok animate-spin" />
        ) : isCompleted ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-state-danger" />
        )}
        <span className="font-bold text-[11px] text-foreground">
          {isInProgress
            ? '독립 상태 검증 진행 중 (IN_PROGRESS)...'
            : isCompleted
            ? '독립 상태 검증 완료 (COMPLETED)'
            : '독립 상태 검증 실패 (FAILED)'}
        </span>
      </div>

      {readbackResult && (
        <div className="bg-background/80 p-2 rounded-lg border border-state-ok/60 text-[10px] font-mono text-state-ok">
          {readbackResult}
        </div>
      )}

      {(targetChannel || targetUrl) && (
        <div className="text-[10px] text-muted-foreground space-y-0.5 truncate">
          {targetChannel && <span>대상 채널: <strong>{targetChannel}</strong> </span>}
          {targetUrl && <span className="font-mono truncate block">&rarr; {targetUrl}</span>}
        </div>
      )}

      {verifiedAt && (
        <div className="text-[9px] text-muted-foreground font-mono">
          검증 시각: {verifiedAt}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 7. EvidenceCard (SHA-256 증거 블록 & 영수증 뷰어)
// ==========================================
export interface EvidenceCardProps {
  evidence: EvidenceResultCardData & {
    sha256?: string;
    evidenceHash?: string;
    receiptId?: string;
    proofChainIndex?: number;
    receiptDetails?: Record<string, unknown>;
  };
  onNavigate?: (url: string) => void;
  onViewReceipt?: (receiptId: string) => void;
}

export function EvidenceCard({ evidence, onNavigate, onViewReceipt }: EvidenceCardProps) {
  const hash = evidence.sha256 || evidence.evidenceHash;

  return (
    <div
      data-testid="event-card-evidence"
      className="p-3 rounded-xl border border-state-ok/40 bg-state-ok-soft text-xs space-y-2.5 transition-all my-1.5 shadow-2xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-state-ok" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-ok/20 text-state-ok ">
            VERIFIED_EVIDENCE
          </span>
        </div>
        <span className="text-[10px] font-mono font-bold text-state-ok">
          {evidence.settledSC || 0} 크레딧 정산
        </span>
      </div>

      <p className="text-[11px] text-state-ok font-medium">
        외부 플랫폼 집행 및 독립 상태 검증(Readback)이 완료되었습니다.
      </p>

      {/* SHA-256 Proof Block */}
      {hash && (
        <div className="p-2 rounded-lg bg-background/90 border border-state-ok/80 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
            <span>증거 확인값</span>
            {evidence.proofChainIndex !== undefined && (
              <span className="font-mono text-[9px]">Block #{evidence.proofChainIndex}</span>
            )}
          </div>
          <div className="font-mono text-[10px] text-state-ok break-all select-all">
            {hash}
          </div>
        </div>
      )}

      {/* Receipt Viewer Button */}
      {evidence.receiptId && (
        <button
          type="button"
          onClick={() => onViewReceipt?.(evidence.receiptId!)}
          className="w-full py-1.5 px-2 rounded-lg border border-state-ok/40 hover:bg-state-ok-soft text-state-ok font-semibold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Receipt className="w-3.5 h-3.5 text-state-ok" />
          <span>영수증 확인 ({evidence.receiptId})</span>
        </button>
      )}

      {/* Verified platform URLs */}
      {evidence.verifiedUrls && evidence.verifiedUrls.length > 0 && (
        <div className="space-y-1">
          {evidence.verifiedUrls.map((item, idx) => (
            <a
              key={idx}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-1.5 rounded-lg bg-background/90 border border-state-ok/80 hover:border-state-ok/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1 py-0.2 rounded">
                  {item.channel}
                </span>
                <span className="text-[10px] text-foreground truncate font-mono">{item.url}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[9px] font-mono font-bold text-state-ok">
                  {item.httpStatus || 200} OK
                </span>
                <ArrowUpRight className="w-3 h-3 text-muted-foreground group-hover:text-state-ok transition-colors" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Navigation action to central workbench */}
      {evidence.navUrl && (
        <button
          type="button"
          onClick={() => onNavigate?.(evidence.navUrl!)}
          className="w-full py-1.5 px-2 rounded-lg bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
        >
          <span>{evidence.navLabel || '작업 결과 확인하기'}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ==========================================
// 8. ResultUnknownCard (Blind Retry 배제 & 수동 Reconcile CTA)
// ==========================================
export interface ResultUnknownCardProps {
  actionRunId?: string;
  message?: string;
  reason?: string;
  checkAfterMs?: number;
  onReconcile?: (actionRunId?: string) => Promise<void> | void;
  isReconciling?: boolean;
}

export function ResultUnknownCard({
  actionRunId,
  message = '외부 플랫폼 처리 결과를 비동기로 대기 중입니다. 상태가 불명확하여 자동 재시도를 차단합니다.',
  reason = '외부 타임아웃 또는 미확인 응답 (중복 집행 방지 위해 자동 재시도 금지)',
  onReconcile,
  isReconciling = false,
}: ResultUnknownCardProps) {
  return (
    <div
      data-testid="event-card-result-unknown"
      className="p-3 rounded-xl border border-state-warn/40 bg-state-warn-soft text-xs space-y-2.5 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-state-warn animate-pulse" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-warn/20 text-state-warn">
            결과 확인 중
          </span>
        </div>
        {actionRunId && (
          <span className="text-[9px] font-mono text-muted-foreground">{actionRunId}</span>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-foreground font-medium leading-relaxed">{message}</p>
        {reason && (
          <p className="text-[10px] text-state-warn bg-state-warn-soft p-1.5 rounded font-mono">
            ⚠️ {reason}
          </p>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground">
        안내: 외부 플랫폼의 이중 과금이나 중복 게시를 방지하기 위해 <strong>무조건적인 자동 재시도(Blind Retry)는 영구 차단</strong>되었습니다.
      </div>

      {/* 수동 상태 대사 (Reconcile) CTA만 노출 */}
      <button
        type="button"
        data-testid="reconcile-cta-button"
        disabled={isReconciling}
        onClick={() => onReconcile?.(actionRunId)}
        className="w-full py-1.5 px-2 rounded-lg bg-state-warn hover:bg-state-warn/90 text-state-warn-soft font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
      >
        {isReconciling ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <RefreshCw className="w-3 h-3" />
        )}
        <span>수동 상태 대사 (Reconcile) 실행</span>
      </button>
    </div>
  );
}

// ==========================================
// 9. BlockedCard (킬스위치, 권한, 정책 가드 카드)
// ==========================================
export interface BlockedCardProps {
  errorCode?: string;
  reason?: 'KILL_SWITCH' | 'PERMISSION_DENIED' | 'POLICY_VIOLATION' | string;
  message: string;
  step?: string;
  onUnblock?: () => void;
}

export function BlockedCard({ errorCode, reason, message, step, onUnblock }: BlockedCardProps) {
  return (
    <div
      data-testid="event-card-blocked"
      className="p-3 rounded-xl border border-state-danger/40 bg-state-danger-soft text-xs space-y-2 transition-all my-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Ban className="w-3.5 h-3.5 text-state-danger" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-danger/20 text-state-danger ">
            BLOCKED
          </span>
          {reason && (
            <span className="text-[9px] font-bold px-1 rounded bg-state-danger-soft text-state-danger ">
              {reason === 'KILL_SWITCH' ? '킬스위치 가동' : reason}
            </span>
          )}
        </div>
        {errorCode && (
          <span className="text-[9px] font-mono text-state-danger font-bold">
            {errorCode}
          </span>
        )}
      </div>

      <p className="text-[11px] text-state-danger font-medium leading-relaxed">
        {message}
      </p>

      {step && (
        <div className="text-[10px] text-muted-foreground font-mono">
          중단 위치: {step}
        </div>
      )}

      {onUnblock && (
        <button
          type="button"
          onClick={onUnblock}
          className="w-full py-1.5 px-2 rounded-lg bg-state-danger hover:bg-state-danger/90 text-state-danger-soft font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
        >
          <span>차단 해제 및 재시도</span>
        </button>
      )}
    </div>
  );
}

// ==========================================
// 10. OutcomeCard (최종 비즈니스 결과 카드)
// ==========================================
export interface OutcomeCardProps {
  outcomeType: 'REVENUE' | 'RESERVATION' | 'PUBLISH_COMPLETE' | string;
  title: string;
  summary: string;
  metrics?: Array<{ label: string; value: string | number; change?: string }>;
  completedAt?: string;
  actionRunId?: string;
}

export function OutcomeCard({
  outcomeType = 'REVENUE',
  title,
  summary,
  metrics,
  completedAt,
  actionRunId,
}: OutcomeCardProps) {
  return (
    <div
      data-testid="event-card-outcome"
      className="p-3 rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-state-wait/10 text-xs space-y-2.5 transition-all my-1.5 shadow-2xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-foreground">
            OUTCOME
          </span>
          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-primary/10 text-primary">
            {outcomeType === 'REVENUE'
              ? '매출 달성'
              : outcomeType === 'RESERVATION'
              ? '예약 확정'
              : outcomeType === 'PUBLISH_COMPLETE'
              ? '게시 완료'
              : outcomeType}
          </span>
        </div>
        {actionRunId && (
          <span className="text-[9px] font-mono text-muted-foreground">{actionRunId}</span>
        )}
      </div>

      <div>
        <h4 className="font-bold text-foreground text-xs leading-snug">{title}</h4>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{summary}</p>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          {metrics.map((m, idx) => (
            <div
              key={idx}
              className="p-1.5 rounded-lg bg-background/90 border border-primary/60 text-center space-y-0.5"
            >
              <div className="text-[9px] text-muted-foreground truncate">{m.label}</div>
              <div className="text-[12px] font-extrabold text-primary">
                {m.value}
              </div>
              {m.change && (
                <div className="text-[8px] font-mono font-semibold text-state-ok">
                  {m.change}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {completedAt && (
        <div className="text-[9px] text-muted-foreground font-mono text-right">
          완료: {new Date(completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 11. PerformanceSummaryCard (주간 마케팅 성과 및 비용 절감 리포트 카드)
// ==========================================
export interface PerformanceSummaryCardData {
  period?: string;
  postsCount: number;
  inquiriesCount: number;
  reservationsCount: number;
  estimatedSavingsWon?: number | null;
  topPostTopic?: string;
  summaryComment?: string;
}

export interface PerformanceSummaryCardProps {
  card: PerformanceSummaryCardData;
  className?: string;
}

export function PerformanceSummaryCard({ card, className }: PerformanceSummaryCardProps) {
  const {
    period = '최근 7일',
    postsCount,
    inquiriesCount,
    reservationsCount,
    estimatedSavingsWon,
    topPostTopic,
    summaryComment = '소희가 운영 대행 없이 직접 콘텐츠 제작과 고객 소통을 도와드렸어요.',
  } = card;

  return (
    <div
      data-testid="event-card-performance-summary"
      className={`p-3.5 rounded-xl border border-state-wait/30 bg-gradient-to-br from-state-wait-soft via-background to-primary/10 text-xs space-y-3 transition-all my-2 shadow-2xs ${className ?? ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-state-wait" />
          <span className="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-state-wait-soft text-state-wait ">
            주간 성과 리포트
          </span>
          <span className="text-[9px] font-semibold text-muted-foreground">{period}</span>
        </div>
        <span className="text-[10px] font-bold text-state-ok bg-state-ok-soft border border-state-ok/20 px-2 py-0.5 rounded-full">
          실시간 집계
        </span>
      </div>

      <div>
        <h4 className="font-bold text-foreground text-sm leading-snug">
          이번 주 소희와 함께 만든 가게 성과예요
        </h4>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
          {summaryComment}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <div className="p-2 rounded-lg bg-card border border-border text-center space-y-0.5 shadow-2xs">
          <div className="text-[10px] text-muted-foreground font-medium">올린 소식</div>
          <div className="text-base font-extrabold text-foreground">{postsCount}건</div>
          <div className="text-[9px] text-muted-foreground">인스타·스레드</div>
        </div>
        <div className="p-2 rounded-lg bg-card border border-border text-center space-y-0.5 shadow-2xs">
          <div className="text-[10px] text-muted-foreground font-medium">고객 문의</div>
          <div className="text-base font-extrabold text-state-wait">{inquiriesCount}건</div>
          <div className="text-[9px] text-muted-foreground">소통함 응대</div>
        </div>
        <div className="p-2 rounded-lg bg-card border border-border text-center space-y-0.5 shadow-2xs">
          <div className="text-[10px] text-muted-foreground font-medium">확정 예약</div>
          <div className="text-base font-extrabold text-primary">{reservationsCount}건</div>
          <div className="text-[9px] text-muted-foreground">CRM 연동</div>
        </div>
        <div className="p-2 rounded-lg bg-state-ok-soft border border-state-ok/30 text-center space-y-0.5 shadow-2xs">
          <div className="text-[10px] text-state-ok font-bold">절감 마케팅비</div>
          <div className="text-base font-extrabold text-state-ok">
            {estimatedSavingsWon != null ? `₩${estimatedSavingsWon.toLocaleString('ko-KR')}` : '미관측'}
          </div>
          <div className="text-[9px] text-state-ok/80 font-medium">
            {estimatedSavingsWon != null ? '대행사 외주 대비' : '실측 집계 대기'}
          </div>
        </div>
      </div>

      {topPostTopic && (
        <div className="p-2 rounded-lg bg-background/80 border border-border text-[11px] flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-state-warn shrink-0" aria-hidden />
          <span className="text-muted-foreground">가장 반응 좋은 소식:</span>
          <strong className="text-foreground truncate">{topPostTopic}</strong>
        </div>
      )}

      <div className="pt-1 flex items-center justify-end">
        <Link
          href="/app/results"
          prefetch={false}
          className="text-xs font-semibold text-state-wait hover:underline flex items-center gap-1"
        >
          <span>자세한 성과 그래프 확인하기</span>
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
