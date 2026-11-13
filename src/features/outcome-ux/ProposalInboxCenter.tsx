'use client';
import React from 'react';
import type { WorkProposal } from '@/types/autonomous-outcome-os';

export interface ProposalInboxCenterProps {
  proposals: WorkProposal[];
  onApproveProposal: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
}

export const ProposalInboxCenter: React.FC<ProposalInboxCenterProps> = ({
  proposals,
  onApproveProposal,
  onRejectProposal,
}) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-xl shadow-sm border border-slate-200 font-sans">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-bold text-slate-900">제안 인박스 & 오토메이션 센터</h2>
        <p className="text-xs text-slate-500 mt-1">
          소희가 발견한 목표 달성용 실행 제안입니다. 승인 시 명시된 권한 범위(Envelope) 내에서 자율 실행됩니다.
        </p>
      </div>

      <div className="space-y-4">
        {proposals.map((proposal) => (
          <div
            key={proposal.proposalId}
            className="border border-slate-200 rounded-xl p-5 bg-slate-50/70 hover:bg-slate-50 transition space-y-3"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">
                {proposal.title}
              </h3>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0 w-fit">
                승인 대기중
              </span>
            </div>

            <p className="text-sm text-slate-700">
              <span className="font-semibold">포착 근거: </span>
              {proposal.rationale}
            </p>

            <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs space-y-1.5 text-slate-600">
              <div className="font-semibold text-slate-800 mb-1">제안된 자율 운영 엔벨로프 (Envelope)</div>
              <div>· 자율 수준: {proposal.proposedEnvelope?.autonomyLevel}</div>
              <div>· 허용 채널: {proposal.proposedEnvelope?.allowedChannels.join(', ')}</div>
              <div>· 일일 최대 발행: {proposal.proposedEnvelope?.maxPostsPerDay}회</div>
              <div>· 최대 에너지 한도: {proposal.proposedEnvelope?.maxAgentEnergyCap} Energy</div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              {onRejectProposal && (
                <button
                  type="button"
                  onClick={() => onRejectProposal(proposal.proposalId)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition"
                >
                  반려
                </button>
              )}
              <button
                type="button"
                onClick={() => onApproveProposal(proposal.proposalId)}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
              >
                승인하고 자율 실행 시작
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
