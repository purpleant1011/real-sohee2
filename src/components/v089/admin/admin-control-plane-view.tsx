"use client";

/**
 * Sohee V0.9 5th Update · Wave 4 Admin
 * Figma Parity Admin Control Plane View (Desktop, Tablet, Mobile)
 * 
 * Traceability: ANI-933
 */

import React, { useState } from 'react';
import {
  Customer360CanonicalRecord,
  ProductionIncident,
  OutcomeSloMetric,
  AdminGlobalSearchResult,
  PrivilegedSupportAuditRecord,
} from '@/types/admin-control-plane';
import { AdminControlPlaneService } from '@/lib/admin/admin-control-plane-service';
import {
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  ArrowRight,
  Send,
  Building2,
  Sparkles,
  Key,
} from 'lucide-react';

interface AdminControlPlaneViewProps {
  initialService?: AdminControlPlaneService;
  operatorSessionId?: string;
}

export function AdminControlPlaneView({
  initialService,
  operatorSessionId = 'op_session_master_001',
}: AdminControlPlaneViewProps) {
  const [service] = useState(() => initialService || new AdminControlPlaneService());
  const [activeTab, setActiveTab] = useState<'CUSTOMER_360' | 'INCIDENTS' | 'SLO' | 'SUPPORT_AUDIT'>('CUSTOMER_360');
  const [datasetFilter, setDatasetFilter] = useState<'ALL' | 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminGlobalSearchResult[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('ws_actual_gangnam_derm');

  // Privileged Support Form State
  const [supportCaseId, setSupportCaseId] = useState('CASE-2026-9041');
  const [supportReason, setSupportReason] = useState('원장님 외부 결제 승인 지연으로 긴급 크레딧 보정 요청');
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  const customerRecords = service.listCustomer360(
    datasetFilter === 'ALL' ? undefined : datasetFilter
  );
  const selectedRecord = service.getCustomer360(selectedWorkspaceId) || customerRecords[0];
  const incidents = service.listActiveIncidents();
  const sloMetrics = service.getOutcomeSloMetrics();
  const auditLogs = service.listAuditLogs();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const res = service.searchGlobal(searchQuery);
    setSearchResults(res);
  };

  const handleExecuteSupportAction = () => {
    setActionSuccessMsg(null);
    setActionErrorMsg(null);
    try {
      const record = service.executePrivilegedSupportAction({
        supportCaseId,
        operatorSessionId,
        workspaceId: selectedRecord.workspaceId,
        actionType: 'CREDIT_ADJUSTMENT',
        reason: supportReason,
        correlationId: `corr_sup_${Date.now()}`,
        actionRunId: 'act_run_emergency_001',
        ledgerEntryId: 'ldg_adj_001',
      });
      setActionSuccessMsg(`특권 조치 승인 및 감사 로그 등록 완료: ${record.auditId} (Digest: ${record.evidenceDigest.slice(0, 18)}...)`);
    } catch (err: any) {
      setActionErrorMsg(err.message || '조치 실행 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-zinc-100 font-sans p-4 md:p-8 space-y-6">
      {/* Top Header: Session & Correlation Trace Bar */}
      <header className="border-b border-zinc-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Key className="w-6 h-6 text-state-ok" />
              Sohee Admin Control Plane
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-state-ok/10 text-state-ok border border-state-ok/30">
              OPERATOR ACTIVE
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Session: <code className="text-zinc-300">{operatorSessionId}</code> · Invariant: Same Truth across Service & Admin
          </p>
        </div>

        {/* Global Search Bar */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 w-full md:w-96">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Workspace, ActionRun, Evidence, Case ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-state-ok/50"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium rounded-lg text-zinc-200 shrink-0"
          >
            검색
          </button>
        </form>
      </header>

      {/* Global Search Results Dropdown / Panel */}
      {searchResults.length > 0 && (
        <div className="bg-zinc-900 border border-state-ok/40 rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-semibold text-state-ok">통합 인덱스 검색 결과 ({searchResults.length}건)</h3>
          <div className="space-y-1.5">
            {searchResults.map((res, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-zinc-950/60 p-2 rounded-lg border border-zinc-800">
                <span className="font-mono text-zinc-400">[{res.matchedEntity}] {res.canonicalId}</span>
                <span className="text-zinc-200">{res.summary}</span>
                <span className="text-zinc-500 text-[10px]">{res.deepLink}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 pb-2">
        <button
          onClick={() => setActiveTab('CUSTOMER_360')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'CUSTOMER_360' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Customer 360
        </button>
        <button
          onClick={() => setActiveTab('INCIDENTS')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
            activeTab === 'INCIDENTS' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 text-state-warn" />
          Incident Center ({incidents.length})
        </button>
        <button
          onClick={() => setActiveTab('SLO')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'SLO' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Outcome SLOs ({sloMetrics.length})
        </button>
        <button
          onClick={() => setActiveTab('SUPPORT_AUDIT')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'SUPPORT_AUDIT' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Support Audit Logs ({auditLogs.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'CUSTOMER_360' && (
        <div className="space-y-6">
          {/* Dataset Filter & Workspace Selector */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-medium">데이터셋 격리:</span>
              {(['ALL', 'ACTUAL', 'SHOWCASE_DEMO', 'TEST'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDatasetFilter(mode)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    datasetFilter === mode
                      ? 'bg-state-ok/20 text-state-ok border border-state-ok/40'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-medium">대상 고객사:</span>
              <select
                value={selectedWorkspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-xs text-zinc-200 focus:outline-none"
              >
                {customerRecords.map((rec) => (
                  <option key={rec.workspaceId} value={rec.workspaceId}>
                    {rec.companyName} ({rec.datasetMode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedRecord && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Organization & Balances */}
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-state-ok" />
                      {selectedRecord.companyName}
                    </h2>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5">{selectedRecord.workspaceId}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedRecord.datasetMode === 'ACTUAL'
                        ? 'bg-state-ok/10 text-state-ok border border-state-ok/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {selectedRecord.datasetMode}
                  </span>
                </div>

                <div className="border-t border-zinc-800 pt-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">대표자</span>
                    <span className="text-zinc-200 font-medium">{selectedRecord.representativeName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">사업자등록번호</span>
                    <span className="text-zinc-200 font-mono">{selectedRecord.businessNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">총 보유 크레딧</span>
                    <span className="text-state-ok font-bold">{selectedRecord.creditBalance.total.toLocaleString()} P</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">실측 누적 매출</span>
                    <span className="text-white font-bold">₩{selectedRecord.totalVerifiedRevenueKrw.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">리스크 지수</span>
                    <span className="text-zinc-200 font-medium">{selectedRecord.riskScore} / 100</span>
                  </div>
                </div>

                {/* Privileged Support Action Box */}
                <div className="border-t border-zinc-800 pt-3 space-y-3">
                  <h3 className="text-xs font-bold text-state-warn flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    운영자 특권 조치 (Privileged Support)
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-0.5">연계 Support Case ID *</label>
                      <input
                        type="text"
                        value={supportCaseId}
                        onChange={(e) => setSupportCaseId(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-0.5">조치 사유 *</label>
                      <input
                        type="text"
                        value={supportReason}
                        onChange={(e) => setSupportReason(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-200"
                      />
                    </div>
                    <button
                      onClick={handleExecuteSupportAction}
                      className="w-full py-1.5 bg-state-warn/20 hover:bg-state-warn/30 text-state-warn border border-state-warn/40 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-3 h-3" />
                      감사 연계 긴급 조치 실행
                    </button>
                    {actionSuccessMsg && (
                      <p className="text-[11px] text-state-ok bg-state-ok/10 p-2 rounded border border-state-ok/30">
                        {actionSuccessMsg}
                      </p>
                    )}
                    {actionErrorMsg && (
                      <p className="text-[11px] text-state-danger bg-state-danger/10 p-2 rounded border border-state-danger/30">
                        {actionErrorMsg}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Right 2 Columns: Canonical ID Chain & Activation Timeline */}
              <div className="lg:col-span-2 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white mb-2">Canonical ID Chain</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">IDENTITY</span>
                      <code className="text-zinc-300 text-[11px] truncate block">{selectedRecord.idChain.identityId}</code>
                    </div>
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">BUSINESS</span>
                      <code className="text-zinc-300 text-[11px] truncate block">{selectedRecord.idChain.businessId}</code>
                    </div>
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">PLAN</span>
                      <code className="text-zinc-300 text-[11px] truncate block">{selectedRecord.idChain.planId}</code>
                    </div>
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">PAYMENT</span>
                      <code className="text-zinc-300 text-[11px] truncate block">{selectedRecord.idChain.latestPaymentId || 'N/A'}</code>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-white mb-3">
                    Activation Timeline (Identity → Business → Workspace → Plan → Channel → Action → Booking → Revenue)
                  </h3>
                  <div className="space-y-2">
                    {selectedRecord.activationTimeline.length === 0 ? (
                      <p className="text-xs text-zinc-500">타임라인 이벤트가 아직 등록되지 않았습니다.</p>
                    ) : (
                      selectedRecord.activationTimeline.map((ev, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-5 h-5 rounded-full bg-state-ok/10 text-state-ok border border-state-ok/30 flex items-center justify-center text-[10px] font-bold">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="font-semibold text-zinc-200">{ev.step}</span>
                              <div className="text-[10px] text-zinc-500 font-mono">
                                ID: {ev.canonicalId} {ev.evidenceId && `· Evidence: ${ev.evidenceId}`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-zinc-400 block">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                            <span className="text-[10px] text-state-ok font-semibold">VERIFIED</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Incidents Tab */}
      {activeTab === 'INCIDENTS' && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-white">Active Incidents (P0 / P1 Severity)</h2>
          {incidents.map((inc) => (
            <div key={inc.incidentId} className="bg-zinc-900/70 border border-state-warn/40 rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-state-warn/20 text-state-warn border border-state-warn/40">
                      {inc.severity}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {inc.state}
                    </span>
                    <h3 className="text-sm font-bold text-white">{inc.title}</h3>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{inc.summary}</p>
                </div>
                <div className="text-right text-xs">
                  <span className="text-zinc-500 block">Owner</span>
                  <span className="text-zinc-300 font-semibold">{inc.incidentOwner}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <div>
                  <span className="text-zinc-500 text-[10px] block">고객사 영향도</span>
                  <span className="text-zinc-300">{inc.customerImpactDescription}</span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] block">완화 및 복구 대책</span>
                  <span className="text-zinc-300">{inc.mitigationPlan}</span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] block">Correlation & Evidence</span>
                  <span className="text-zinc-400 font-mono text-[11px] block">{inc.correlationId}</span>
                  <span className="text-zinc-500 font-mono text-[10px] block">{inc.evidenceId}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outcome SLOs Tab */}
      {activeTab === 'SLO' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Outcome 기반 7대 서비스 SLO</h2>
            <span className="text-[11px] text-zinc-500">
              * Invariant: Source Metric 및 Freshness 없는 Healthy 배지 0건 강제
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sloMetrics.map((slo) => (
              <div key={slo.sloKey} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-xs font-semibold text-zinc-300">{slo.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      slo.isHealthy
                        ? 'bg-state-ok/10 text-state-ok border border-state-ok/30'
                        : 'bg-state-danger/10 text-state-danger border border-state-danger/30'
                    }`}
                  >
                    {slo.isHealthy ? 'HEALTHY' : 'BREACHED'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white">
                    {slo.currentValue}
                    <span className="text-xs font-normal text-zinc-400 ml-0.5">{slo.unit}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    (목표: {slo.targetThreshold}{slo.unit})
                  </span>
                </div>

                <div className="border-t border-zinc-800/80 pt-2 text-[10px] text-zinc-400 space-y-1 font-mono">
                  <div>Source: <span className="text-zinc-300">{slo.sourceMetric}</span></div>
                  <div className="flex justify-between text-zinc-500">
                    <span>Freshness: {slo.freshnessSeconds}s ago</span>
                    <span>{new Date(slo.measuredAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support Audit Logs Tab */}
      {activeTab === 'SUPPORT_AUDIT' && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-white">Privileged Support Audit Logs</h2>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-zinc-500">등록된 감사 로그가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.auditId} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-state-warn">[{log.actionType}] Case: {log.supportCaseId}</span>
                    <span className="text-zinc-500 text-[11px]">{new Date(log.executedAt).toLocaleString()}</span>
                  </div>
                  <p className="text-zinc-300">{log.reason}</p>
                  <div className="text-[10px] text-zinc-500 font-mono flex flex-wrap gap-x-4">
                    <span>Operator: {log.operatorSessionId}</span>
                    <span>Workspace: {log.workspaceId}</span>
                    <span>Correlation: {log.correlationId}</span>
                    <span>Digest: {log.evidenceDigest}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
