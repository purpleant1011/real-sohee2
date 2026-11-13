'use client';
import React from 'react';

export interface TraceData {
  workspaceId: string;
  goal: string;
  harnessVersion: string;
  proposal: string;
  envelope: string;
  agentBuild: string;
  runId: string;
  receipt: string;
  outcome: string;
}

export interface AdminCustomer360TimelineProps {
  trace: TraceData;
}

export const AdminCustomer360Timeline: React.FC<AdminCustomer360TimelineProps> = ({
  trace,
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6 font-sans">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-bold text-slate-900">Customer 360 Lineage Trace</h2>
        <p className="text-xs text-slate-500 mt-1">
          목표 수립부터 하네스, 제안, 엔벨로프, 런타임 빌드, 실행 영수증, 최종 성과까지 이어지는 무손실 인과 추적선
        </p>
      </div>

      <div className="relative border-l-2 border-indigo-200 ml-4 pl-6 space-y-6">
        <div className="relative">
          <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-indigo-600" />
          <div className="text-xs font-semibold text-indigo-600 uppercase">1. Goal & Harness</div>
          <div className="text-sm font-bold text-slate-900 mt-0.5">{trace.goal}</div>
          <div className="text-xs font-mono text-slate-500 mt-1">
            Harness: <span>{trace.harnessVersion}</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-indigo-600" />
          <div className="text-xs font-semibold text-indigo-600 uppercase">2. Proposal & Envelope</div>
          <div className="text-sm font-bold text-slate-900 mt-0.5">{trace.proposal}</div>
          <div className="text-xs text-slate-600 mt-1">
            Envelope: <span>{trace.envelope}</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-indigo-600" />
          <div className="text-xs font-semibold text-indigo-600 uppercase">3. Runtime Execution & Build</div>
          <div className="text-xs font-mono text-slate-800 bg-slate-100 p-2 rounded mt-1">
            Build: <span>{trace.agentBuild}</span> · RunID: <span>{trace.runId}</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-emerald-600" />
          <div className="text-xs font-semibold text-emerald-600 uppercase">4. Verified Receipt & Outcome</div>
          <div className="text-xs font-mono text-slate-700 mt-0.5">
            Receipt: <span className="font-bold text-indigo-700">{trace.receipt}</span>
          </div>
          <div className="text-sm font-bold text-emerald-700 mt-1">
            {trace.outcome}
          </div>
        </div>
      </div>
    </div>
  );
};
