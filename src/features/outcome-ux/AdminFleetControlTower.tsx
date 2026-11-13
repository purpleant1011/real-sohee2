'use client';
import React from 'react';

export interface AdminFleetControlTowerProps {
  totalWorkspaces: number;
  activeAutomations: number;
  schedulerLagSeconds: number;
  killSwitchState: string;
  onTriggerKillSwitch?: () => void;
}

export const AdminFleetControlTower: React.FC<AdminFleetControlTowerProps> = ({
  totalWorkspaces,
  activeAutomations,
  schedulerLagSeconds,
  killSwitchState,
  onTriggerKillSwitch,
}) => {
  return (
    <div className="bg-slate-900 text-white p-6 rounded-xl shadow-lg border border-slate-800 space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
        <div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-900/60 text-emerald-400 border border-emerald-700">
            Admin V0.4
          </span>
          <h1 className="text-xl font-bold mt-1 text-white">
            Autonomous Operations Control Tower
          </h1>
          <p className="text-xs text-slate-400">
            전체 워크스페이스 상시 자율 운영 상태 및 글로벌 관제 타워
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right">
            <div className="text-xs text-slate-400">Kill Switch Status</div>
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
              killSwitchState === 'NORMAL' ? 'bg-emerald-900 text-emerald-300' : 'bg-rose-900 text-rose-300'
            }`}>
              {killSwitchState}
            </span>
          </div>
          {onTriggerKillSwitch && (
            <button
              type="button"
              onClick={onTriggerKillSwitch}
              className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded transition"
            >
              긴급 정지
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700">
          <div className="text-xs text-slate-400">전체 워크스페이스 (Fleet)</div>
          <div className="text-2xl font-black text-white mt-1">
            {totalWorkspaces.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700">
          <div className="text-xs text-slate-400">활성 오토메이션 인스턴스</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            {activeAutomations.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-800/80 p-4 rounded-lg border border-slate-700">
          <div className="text-xs text-slate-400">스케줄러 지연 시간 (Lag)</div>
          <div className="text-2xl font-black text-indigo-400 mt-1">
            {schedulerLagSeconds}s
          </div>
        </div>
      </div>
    </div>
  );
};
