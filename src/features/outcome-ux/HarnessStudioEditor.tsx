'use client';
import React, { useState } from 'react';
import type { WorkspaceKnowledgeHarness } from '@/types/autonomous-outcome-os';

export interface HarnessStudioEditorProps {
  harness: WorkspaceKnowledgeHarness;
  onSave?: (updated: WorkspaceKnowledgeHarness) => void;
}

export const HarnessStudioEditor: React.FC<HarnessStudioEditorProps> = ({
  harness,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'identity' | 'voice' | 'policies'>('identity');
  const [currentHarness, setCurrentHarness] = useState<WorkspaceKnowledgeHarness>(harness);

  const handleSave = () => {
    onSave?.(currentHarness);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
      {/* Header with Version Pill */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">우리 가게 작업 기준 편집기</h2>
          <p className="text-xs text-slate-500 mt-1">
            소희의 모든 판단과 결정을 정해진 범위 안에 두는, 한 번 확정하면 바뀌지 않는 지식 기준 원본입니다.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium text-slate-500">기준 버전:</span>
          <span className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-100 text-slate-800 rounded border border-slate-300">
            {currentHarness.harnessVersionId}
          </span>
          <span className="px-2 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded">
            v{currentHarness.versionNo} ACTIVE
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('identity')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'identity'
              ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          정체성 & 영업시간
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('voice')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'voice'
              ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          브랜드 보이스
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('policies')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'policies'
              ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          운영 정책
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'identity' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">사업체명</label>
            <input
              type="text"
              className="w-full p-2.5 text-base md:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={currentHarness.businessIdentity.businessName}
              onChange={(e) =>
                setCurrentHarness({
                  ...currentHarness,
                  businessIdentity: {
                    ...currentHarness.businessIdentity,
                    businessName: e.target.value,
                  },
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">영업시간</label>
            <input
              type="text"
              className="w-full p-2.5 text-base md:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={currentHarness.businessIdentity.operatingHours}
              onChange={(e) =>
                setCurrentHarness({
                  ...currentHarness,
                  businessIdentity: {
                    ...currentHarness.businessIdentity,
                    operatingHours: e.target.value,
                  },
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">사업장 위치 및 관할 구역</label>
            <input
              type="text"
              className="w-full p-2.5 text-base md:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={currentHarness.businessIdentity.locationDistrict}
              onChange={(e) =>
                setCurrentHarness({
                  ...currentHarness,
                  businessIdentity: {
                    ...currentHarness.businessIdentity,
                    locationDistrict: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      )}

      {activeTab === 'voice' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">브랜드 톤 & 매너</label>
            <div className="text-sm font-medium text-slate-800 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              {currentHarness.brandVoice.tone}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">금지 키워드 (소희 자율 발신 절대 차단)</label>
            <div className="flex flex-wrap gap-2">
              {currentHarness.brandVoice.prohibitedKeywords.map((kw, idx) => (
                <span key={idx} className="px-2.5 py-1 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-md font-medium">
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">의무 명시 문구</label>
            <div className="space-y-1">
              {currentHarness.brandVoice.mandatoryDisclaimers.map((disc, idx) => (
                <div key={idx} className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                  {disc}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">최대 할인 한도 (%)</label>
              <input
                type="number"
                className="w-full p-2.5 text-base md:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={currentHarness.policies.maxDiscountPercent}
                onChange={(e) =>
                  setCurrentHarness({
                    ...currentHarness,
                    policies: {
                      ...currentHarness.policies,
                      maxDiscountPercent: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">일일 최대 포스팅 수</label>
              <input
                type="number"
                className="w-full p-2.5 text-base md:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={currentHarness.policies.maxPostsPerDay}
                onChange={(e) =>
                  setCurrentHarness({
                    ...currentHarness,
                    policies: {
                      ...currentHarness.policies,
                      maxPostsPerDay: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">심야 무음 시간 (Quiet Hours)</label>
            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              {currentHarness.policies.quietHoursStart} ~ {currentHarness.policies.quietHoursEnd} (해당 시간대 자동 발행 차단)
            </div>
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
        >
          기준 변경사항 저장
        </button>
      </div>
    </div>
  );
};
