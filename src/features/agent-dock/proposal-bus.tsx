'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ProposalPayload, ProposalStatus } from './types';
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context';
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard';
import type { ExternalWriteKind } from '@/features/pwa/action-guard';

/**
 * 승인 1건이 실제로 실행하는 외부 쓰기 종류 (ANI-1778).
 * 서버 `agent-approval-service` 의 PROPOSAL_TYPE_TOOL_MAP 과 같은 축을 쓴다.
 */
export function approvalWriteKind(approvalType?: string): ExternalWriteKind {
  switch (approvalType) {
    case 'DM_SEND_APPROVAL':
    case 'COMMENT_REPLY_APPROVAL':
      return 'send';
    case 'RESERVATION_CONFIRMATION':
      return 'reservation';
    default:
      return 'publish';
  }
}

export const PROPOSAL_APPLIED_EVENT = 'sohee:proposal_applied';
export const PROPOSAL_CREATED_EVENT = 'sohee:proposal_created';

export interface ProposalBusValue {
  proposals: ProposalPayload[];
  activeProposals: ProposalPayload[];
  propose: (proposal: Omit<ProposalPayload, 'id' | 'status' | 'createdAt'>) => ProposalPayload;
  acceptProposal: (id: string, expectedVersion?: number) => Promise<boolean>;
  rejectProposal: (id: string, reason?: string) => Promise<boolean>;
  getProposal: (id: string) => ProposalPayload | undefined;
  lastError?: string | null;
}

const ProposalBusContext = createContext<ProposalBusValue | null>(null);

export function ProposalBusProvider({
  children,
  workspaceId: propWorkspaceId
}: {
  children: React.ReactNode;
  workspaceId?: string;
}) {
  const context = useOptionalWorkspaceContext();
  const workspaceId = (propWorkspaceId && propWorkspaceId !== 'ws-default')
    ? propWorkspaceId
    : (context?.workspaceId || '');

  const [proposals, setProposals] = useState<ProposalPayload[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const runExternalWrite = useExternalWriteGuard();

  // Sync server pending approvals on mount or workspace change
  useEffect(() => {
    if (!workspaceId || workspaceId === 'ws-default') return;
    let isCancelled = false;

    async function syncServerApprovals() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals?status=PENDING`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.approvals) && !isCancelled) {
          const serverProposals: ProposalPayload[] = data.approvals.map((ap: any) => ({
            id: ap.proposalId,
            type: (ap.proposalType as any) || 'CONTENT_DRAFT',
            title: ap.title,
            description: ap.description,
            targetField: ap.targetField,
            currentValue: ap.currentValue,
            proposedValue: ap.proposedValue,
            status: ap.status as ProposalStatus,
            createdAt: ap.createdAt,
            version: typeof ap.version === 'number' ? ap.version : undefined,
            approvalType: typeof ap.proposalType === 'string' ? ap.proposalType : undefined,
          }));

          setProposals((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const fresh = serverProposals.filter((sp) => !existingIds.has(sp.id));
            return [...fresh, ...prev];
          });
        }
      } catch {}
    }

    syncServerApprovals();
    return () => { isCancelled = true; };
  }, [workspaceId]);

  const propose = useCallback((item: Omit<ProposalPayload, 'id' | 'status' | 'createdAt'>): ProposalPayload => {
    const newProposal: ProposalPayload = {
      ...item,
      id: `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    setProposals((prev) => [newProposal, ...prev]);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(PROPOSAL_CREATED_EVENT, { detail: newProposal })
      );
    }

    return newProposal;
  }, []);

  const acceptProposal = useCallback(async (id: string, expectedVersion?: number): Promise<boolean> => {
    setLastError(null);

    const proposal = proposals.find((p) => p.id === id);
    // 승인은 서버에서 발송·게시·예약 같은 외부 쓰기를 실행한다. 오프라인이면 요청을 내보내지 않고,
    // 같은 승인이 진행 중이면 두 번째 클릭은 아무 것도 하지 않는다.
    const outcome = await runExternalWrite(
      approvalWriteKind(proposal?.approvalType),
      id,
      async () => {
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proposalId: id,
              action: 'APPROVE',
              expectedVersion: expectedVersion ?? proposal?.version,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error?.message || `승인 처리 실패 (${res.status})`;
            setLastError(errMsg);
            return false;
          }

          setProposals((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: 'ACCEPTED' } : p))
          );

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(PROPOSAL_APPLIED_EVENT, { detail: { id, status: 'ACCEPTED' } })
            );
          }
          return true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '네트워크 오류';
          setLastError(msg);
          return false;
        }
      },
    );

    if (!outcome.ran) {
      setLastError(outcome.decision.message);
      return false;
    }
    return outcome.value;
  }, [workspaceId, proposals, runExternalWrite]);

  const rejectProposal = useCallback(async (id: string, reason?: string): Promise<boolean> => {
    setLastError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: id,
          action: 'REJECT',
          rejectionReason: reason,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setLastError(errData.error?.message || '거절 처리 실패');
        return false;
      }

      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'REJECTED' } : p))
      );
      return true;
    } catch {
      setLastError('네트워크 오류');
      return false;
    }
  }, [workspaceId]);

  const getProposal = useCallback(
    (id: string) => proposals.find((p) => p.id === id),
    [proposals]
  );

  const activeProposals = proposals.filter((p) => p.status === 'PENDING');

  return (
    <ProposalBusContext.Provider
      value={{
        proposals,
        activeProposals,
        propose,
        acceptProposal,
        rejectProposal,
        getProposal,
        lastError,
      }}
    >
      {children}
    </ProposalBusContext.Provider>
  );
}

export function useProposalBus() {
  const ctx = useContext(ProposalBusContext);
  if (!ctx) {
    return {
      proposals: [],
      activeProposals: [],
      propose: (item: any) => ({
        ...item,
        id: 'mock-prop',
        status: 'PENDING' as ProposalStatus,
        createdAt: new Date().toISOString(),
      }),
      acceptProposal: async () => false,
      rejectProposal: () => {},
      getProposal: () => undefined,
    };
  }
  return ctx;
}
