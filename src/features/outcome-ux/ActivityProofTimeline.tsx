'use client';
import React from 'react';

export interface ActivityItem {
  id: string;
  time: string;
  title: string;
  status: string;
  evidenceUrl?: string;
  costEnergy: number;
}

export interface ActivityProofTimelineProps {
  activities: ActivityItem[];
}

export const ActivityProofTimeline: React.FC<ActivityProofTimelineProps> = ({
  activities,
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6 font-sans">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-bold text-slate-900">활동 실측 타임라인 (Proof Timeline)</h2>
        <p className="text-xs text-slate-500 mt-1">
          단순 텍스트 설명이 아닌 Read-after-write 실측 영수증과 에너지 원장으로 검증된 실제 이력입니다.
        </p>
      </div>

      <div className="space-y-4">
        {activities.map((act) => (
          <div
            key={act.id}
            className="flex items-start justify-between p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition"
          >
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono text-slate-400">{act.time}</span>
                <h3 className="text-sm font-bold text-slate-900">{act.title}</h3>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                {act.status === 'VERIFIED' ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    외부 검증 완료
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {act.status}
                  </span>
                )}
                {act.evidenceUrl && (
                  <a
                    href={act.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    실측 영수증 열람
                  </a>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-xs font-mono font-semibold text-slate-600">
                {act.costEnergy} Energy
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
