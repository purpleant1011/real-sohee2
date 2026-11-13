'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldAlert } from 'lucide-react';
import { useWorkspaceId } from '@/hooks/use-workspace-context';
import type {
  WorkspaceKnowledgeHarness,
  AgentEnergyLedger,
  WorkProposal,
} from '@/types/autonomous-outcome-os';

import type { ActivityItem } from '@/features/outcome-ux/ActivityProofTimeline';

const TodayOperationsDashboard = dynamic(
  () => import('@/features/outcome-ux/TodayOperationsDashboard').then((m) => m.TodayOperationsDashboard),
  { ssr: false }
);
const ProposalInboxCenter = dynamic(
  () => import('@/features/outcome-ux/ProposalInboxCenter').then((m) => m.ProposalInboxCenter),
  { ssr: false }
);
const ActivityProofTimeline = dynamic(
  () => import('@/features/outcome-ux/ActivityProofTimeline').then((m) => m.ActivityProofTimeline),
  { ssr: false }
);
const HarnessStudioEditor = dynamic(
  () => import('@/features/outcome-ux/HarnessStudioEditor').then((m) => m.HarnessStudioEditor),
  { ssr: false }
);
const SecondaryChatAdvisorDrawer = dynamic(
  () => import('@/features/outcome-ux/SecondaryChatAdvisorDrawer').then((m) => m.SecondaryChatAdvisorDrawer),
  { ssr: false }
);

export default function OutcomeCockpitPage() {
  const workspaceId = useWorkspaceId();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [harness, setHarness] = useState<WorkspaceKnowledgeHarness | null>(null);
  const [energyLedger, setEnergyLedger] = useState<AgentEnergyLedger | null>(null);
  const [proposals, setProposals] = useState<WorkProposal[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCanonicalData() {
      if (!workspaceId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // 1. Load Harness
        const harnessRes = await fetch(`/api/workspaces/${workspaceId}/harness`);
        if (harnessRes.ok) {
          const harnessData = await harnessRes.json();
          if (!cancelled && harnessData?.harness) {
            setHarness(harnessData.harness);
          }
        }

        // 2. Load Energy
        const energyRes = await fetch(`/api/workspaces/${workspaceId}/agent/energy`);
        if (energyRes.ok) {
          const energyData = await energyRes.json();
          const hasValidCapacity =
            typeof energyData?.monthlyTotalEnergy === 'number' &&
            Number.isFinite(energyData.monthlyTotalEnergy);
          const hasValidBalance =
            typeof energyData?.remainingAvailableEnergy === 'number' &&
            Number.isFinite(energyData.remainingAvailableEnergy);

          if (!cancelled) {
            if (energyData && hasValidCapacity && hasValidBalance) {
              setEnergyLedger({
                workspaceId,
                planTier: energyData.planTier || 'FREE_TASTE',
                monthlyTotalEnergy: energyData.monthlyTotalEnergy,
                usedEnergyCurrentMonth:
                  typeof energyData.usedEnergyCurrentMonth === 'number' &&
                  Number.isFinite(energyData.usedEnergyCurrentMonth)
                    ? energyData.usedEnergyCurrentMonth
                    : 0,
                reservedEnergyActiveRuns:
                  typeof energyData.reservedEnergyActiveRuns === 'number' &&
                  Number.isFinite(energyData.reservedEnergyActiveRuns)
                    ? energyData.reservedEnergyActiveRuns
                    : 0,
                remainingAvailableEnergy: energyData.remainingAvailableEnergy,
                burnRatePercentage:
                  typeof energyData.burnRatePercentage === 'number' &&
                  Number.isFinite(energyData.burnRatePercentage)
                    ? energyData.burnRatePercentage
                    : 0,
                budgetAlertStage: energyData.budgetAlertStage || 'NORMAL',
                forecastRunOutDays:
                  typeof energyData.forecastRunOutDays === 'number' &&
                  Number.isFinite(energyData.forecastRunOutDays)
                    ? energyData.forecastRunOutDays
                    : null,
                updatedAt: energyData.updatedAt || new Date().toISOString(),
              });
            } else {
              setEnergyLedger(null);
            }
          }
        } else if (!cancelled) {
          setEnergyLedger(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load canonical outcome data');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadCanonicalData();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleApproveProposal = async (proposalId: string) => {
    setProposals((prev) => prev.filter((p) => p.proposalId !== proposalId));
    if (!workspaceId) return;
    try {
      await fetch(`/api/workspaces/${workspaceId}/agent/energy/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1, missionId: proposalId }),
      });
    } catch {
      // fail-closed
    }
  };

  const handleSaveHarness = (updated: WorkspaceKnowledgeHarness) => {
    setHarness(updated);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6 animate-pulse">
        <div className="h-10 w-72 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-64 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-64 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto my-16 p-8 rounded-3xl bg-state-danger-soft border border-state-danger/30 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-state-danger mx-auto" />
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">데이터 조회 중 오류가 발생했습니다</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{error}</p>
        <Link
          href="/app"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-bold transition-all"
        >
          사령부 홈으로 이동
        </Link>
      </div>
    );
  }

  // Fail-closed to SETUP_REQUIRED when no canonical harness exists
  if (!harness) {
    return (
      <div className="max-w-3xl mx-auto my-12 p-8 sm:p-12 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto text-primary">
          <Sparkles className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-black text-zinc-950 dark:text-zinc-50">
            소희의 업무 기준이 설정되지 않았습니다
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-lg mx-auto leading-relaxed">
            사장님 매장의 고유한 상품, 톤앤매너, 운영 정책이 담긴 업무 기준을 먼저 등록해야 자율 마케팅 성과 대시보드가 활성화됩니다.
          </p>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/start"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all"
          >
            <span>매장 온보딩 시작하기</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold transition-all"
          >
            소희 사령부 홈으로 이동
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
      {/* 1. Today Dashboard */}
      <TodayOperationsDashboard
        harness={harness}
        energyLedger={energyLedger}
        pendingProposals={proposals}
        verifiedOutcomesCount={activities.filter((a) => a.status === 'VERIFIED').length}
        currentRunningTask="실제 매장 운영 기준 기반 시장 기회 및 마케팅 업무 모니터링 중"
      />

      {/* 2. Proposal Inbox Center */}
      <ProposalInboxCenter
        proposals={proposals}
        onApproveProposal={handleApproveProposal}
        onRejectProposal={(id) => setProposals((prev) => prev.filter((p) => p.proposalId !== id))}
      />

      {/* 3. Activity Proof Timeline */}
      <ActivityProofTimeline activities={activities} />

      {/* 4. Harness Studio */}
      <HarnessStudioEditor harness={harness} onSave={handleSaveHarness} />

      {/* 5. Secondary Chat Advisor Drawer */}
      <SecondaryChatAdvisorDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        onSendMessage={() => {}}
      />
    </div>
  );
}
