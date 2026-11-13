'use client';
import React from 'react';
import type {
  WorkspaceKnowledgeHarness,
  AgentEnergyLedger,
  WorkProposal,
} from '@/types/autonomous-outcome-os';

export interface TodayOperationsDashboardProps {
  harness: WorkspaceKnowledgeHarness;
  energyLedger: AgentEnergyLedger | null;
  pendingProposals: WorkProposal[];
  verifiedOutcomesCount: number;
  currentRunningTask?: string;
  onApproveProposal?: (proposalId: string) => void;
}

export const TodayOperationsDashboard: React.FC<TodayOperationsDashboardProps> = ({
  harness,
  energyLedger,
  pendingProposals,
  verifiedOutcomesCount,
  currentRunningTask = '현재 대기 중인 상시 감시 작업이 없습니다.',
  onApproveProposal,
}) => {
  return (
    <div className="space-y-6 p-6 bg-slate-50 min-h-screen text-slate-900 font-sans">
      {/* Top Header: Business Identity */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
            Autonomous Outcome OS V0.9
          </span>
          <h1 className="text-2xl font-bold mt-1 text-slate-900">
            {harness.businessIdentity.businessName}
          </h1>
          <p className="text-sm text-slate-500">
            {harness.businessIdentity.brandSummary} · {harness.businessIdentity.locationDistrict}
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex items-center space-x-3">
          <div className="text-right">
            <div className="text-xs text-slate-500">가용 에이전트 에너지</div>
            {energyLedger ? (
              <div className="text-base font-bold text-indigo-600">
                {energyLedger.remainingAvailableEnergy.toLocaleString()} / {energyLedger.monthlyTotalEnergy.toLocaleString()} Energy
              </div>
            ) : (
              <div className="text-sm font-medium text-slate-500">
                크레딧 정보를 확인할 수 없어요
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Grid: 6 Core Questions Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Q1: 소희가 지금 하고 있는 일 */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                소희가 지금 하고 있는 일
              </h2>
            </div>
            <p className="text-base font-medium text-slate-800 leading-relaxed mt-2">
              {currentRunningTask}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
            <span>실시간 자율 실행 상태</span>
            <span className="font-mono text-emerald-600 font-semibold">ACTIVE RUN</span>
          </div>
        </section>

        {/* Q2: 성과 달성 현황 */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                검증된 실측 성과 (WVAO)
              </h2>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold text-slate-900">
                {verifiedOutcomesCount}건 달성
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Read-after-write 실측 영수증 기준 외부 검증 완료
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
            <span>추정 지표(ESTIMATED) 배제 원칙 준수</span>
          </div>
        </section>

        {/* Q3: 이번 달 남은 자원 / 에너지 소진 예측 */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                월간 에너지 런아웃 예측
              </h2>
            </div>
            {energyLedger ? (
              <div className="mt-3">
                {energyLedger.forecastRunOutDays !== null ? (
                  <div className="text-3xl font-extrabold text-indigo-600">
                    {energyLedger.forecastRunOutDays}일 남음
                  </div>
                ) : (
                  <div className="text-lg font-semibold text-slate-500">
                    예측 정보 없음
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  현재 소진율 {energyLedger.burnRatePercentage}% (단계: {energyLedger.budgetAlertStage})
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-500">
                  크레딧 정보를 확인할 수 없어요
                </p>
              </div>
            )}
          </div>
          {energyLedger && (
            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
              <span>예약된 실행량: {energyLedger.reservedEnergyActiveRuns} Energy</span>
              <span>사용 완료: {energyLedger.usedEnergyCurrentMonth} Energy</span>
            </div>
          )}
        </section>
      </div>

      {/* Pending Proposals Section: 승인 필요 제안 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <span>승인 필요 제안</span>
              <span className="px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 rounded-full">
                {pendingProposals.length}건 대기 중
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              소희가 포착한 사업적 기회와 계획입니다. 승인 시 즉시 자율 실행 범위(Envelope)가 발효됩니다.
            </p>
          </div>
        </div>

        {pendingProposals.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
            현재 대기 중인 승인 요청이 없습니다. 소희가 상시 관찰 중입니다.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingProposals.map((proposal) => (
              <div
                key={proposal.proposalId}
                className="p-5 border border-slate-200 rounded-lg hover:border-indigo-300 transition-colors bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                      목표 연동
                    </span>
                    <h3 className="text-base font-bold text-slate-900">
                      {proposal.title}
                    </h3>
                  </div>
                  <p className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-700">추진 근거: </span>
                    {proposal.rationale}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 pt-1">
                    <span>예상 성과: {proposal.expectedOutcome.metricType} ({proposal.expectedOutcome.estimatedMin} ~ {proposal.expectedOutcome.estimatedMax})</span>
                    <span>·</span>
                    <span>예상 에너지: {proposal.estimatedAgentEnergy} Energy</span>
                    <span>·</span>
                    <span>권한 범위: {proposal.proposedEnvelope?.autonomyLevel}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => onApproveProposal?.(proposal.proposalId)}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition shadow-sm"
                  >
                    승인하고 자율 실행 시작
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
