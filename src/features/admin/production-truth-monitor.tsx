'use client'

/**
 * Production Creative Truth Monitor Component (Wave 6: ANI-1139)
 * 
 * Invariants:
 * 1. Single SSOT: Directly fed by live ProductionTruthSnapshot.
 * 2. Fail-Closed: Never collapses UNKNOWN/STALE/ERROR into PASS.
 * 3. Exact Approval Guard: Displays NO_BUNDLES_PENDING when creative_bundles = 0 (prohibits fake PASS).
 * 4. Zero mocked data in production.
 */

import React from 'react'
import {
  evaluateCreativeTruthVerdict,
  type CreativeTruthSnapshot,
} from './admin-truth-snapshot-service'

export interface ProductionTruthMonitorProps {
  snapshot: CreativeTruthSnapshot
  onRefresh?: () => void
}

export function ProductionTruthMonitor({ snapshot, onRefresh }: ProductionTruthMonitorProps) {
  const verdictResult = evaluateCreativeTruthVerdict(snapshot)
  const { verdict, exactApprovalStatus, securityAdvisorStatus, provenanceStatus, freshnessStatus, findings } = verdictResult

  const isBlocked = verdict === 'RELEASE_BLOCKED'
  const isAligned = verdict === 'FRESH_ALIGNED'

  return (
    <div className="w-full space-y-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 font-sans shadow-2xl">
      {/* 1. Header & Live Ground Truth Metadata */}
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Production Creative Truth Monitor
            </h2>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-300">
              Live Evidence
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            소희 12차 단일 정본 스냅샷(SSOT) 기반 실시간 프로덕션 무결성 검증 센터
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
          >
            새로고침
          </button>
        )}
      </div>

      {/* 2. Metadata Strip (SHA, Build ID, Migration, ObservedAt, EvidenceID) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 rounded-lg bg-zinc-900/60 p-3 text-xs font-mono border border-zinc-800/80">
        <div>
          <div className="text-zinc-500">Release SHA</div>
          <div className="font-semibold text-zinc-200">{(snapshot.git?.sha || 'unknown').slice(0, 8)}</div>
        </div>
        <div>
          <div className="text-zinc-500">Build ID</div>
          <div className="font-semibold text-zinc-200">{snapshot.deployment.buildId}</div>
        </div>
        <div>
          <div className="text-zinc-500">Migration Head</div>
          <div className="font-semibold text-zinc-200 truncate" title={snapshot.database.migrationHead}>
            {snapshot.database.migrationHead}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Observed At</div>
          <div className="font-semibold text-zinc-200 truncate" title={snapshot.observedAt}>
            {snapshot.observedAt}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Evidence ID</div>
          <div className="font-semibold text-emerald-400 truncate" title={snapshot.evidenceId}>
            {snapshot.evidenceId}
          </div>
        </div>
      </div>

      {/* 3. Master Verdict Banner */}
      <div
        className={`rounded-lg border p-4 transition-all ${
          isAligned
            ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
            : isBlocked
            ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
            : 'border-amber-500/40 bg-amber-950/20 text-amber-300'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-extrabold uppercase tracking-wide">
              {verdict}
            </span>
            <span className="rounded px-2 py-0.5 text-xs font-semibold uppercase bg-zinc-900 border border-current">
              {freshnessStatus}
            </span>
          </div>
          <div className="text-xs font-medium">
            {isAligned
              ? '모든 프로덕션 인베리언트 통과 · 릴리스 준비 완료'
              : isBlocked
              ? 'P0 결함 또는 인베리언트 위반 감지 · 릴리스 차단됨'
              : '런타임 드리프트 감지 · 주의 필요'}
          </div>
        </div>

        {findings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs border-t border-current/20 pt-2.5">
            {findings.map((f, idx) => (
              <li key={idx} className="flex items-start gap-1.5 font-mono">
                <span>⚠️</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 4. 7-Dimensional Ground Truth Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Dim 1: Generated Media */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">1. Generated Media Assets</div>
          <div className="text-2xl font-mono font-bold text-white">
            {snapshot.database.tableCounts.mediaAssets}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            OpenAI Generated: {snapshot.database.provenance.generatedOpenAiCount}건
          </div>
        </div>

        {/* Dim 2: Provenance Integrity */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">2. Provenance Integrity</div>
          <div className="text-2xl font-mono font-bold text-white">
            <span
              className={`rounded px-1.5 py-0.5 text-sm ${
                provenanceStatus === 'CLEAN' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
              }`}
            >
              {provenanceStatus}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            Meta 누락: {snapshot.database.provenance.missingModelMetadataCount} / Checksum 누락: {snapshot.database.provenance.missingSha256Count}
          </div>
        </div>

        {/* Dim 3: Creative Bundle Exact Approval */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">3. Bundle Exact Approval</div>
          <div className="text-2xl font-mono font-bold text-white flex items-center gap-2">
            <span>{snapshot.database.tableCounts.creativeBundles}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                exactApprovalStatus === 'PASS'
                  ? 'bg-emerald-950 text-emerald-400'
                  : 'bg-rose-950 text-rose-400'
              }`}
            >
              {exactApprovalStatus}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            {snapshot.database.tableCounts.creativeBundles === 0
              ? '번들 0건 (PASS 차단)'
              : '암호화 지문 일치 승인됨'}
          </div>
        </div>

        {/* Dim 4: Rendition & Lease */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">4. Rendition & Delivery Lease</div>
          <div className="text-2xl font-mono font-bold text-white">
            {snapshot.database.tableCounts.publishRenditions}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            Active Leases: {snapshot.database.tableCounts.providerDeliveryLeases}건
          </div>
        </div>

        {/* Dim 5: Provider Readback Receipts */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">5. Readback & Observed Media</div>
          <div className="text-2xl font-mono font-bold text-white">
            {snapshot.database.tableCounts.externalActionReceipts}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            Observed Media: {snapshot.database.tableCounts.providerObservedMedia}건
          </div>
        </div>

        {/* Dim 6: Security Advisor */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1">
          <div className="text-xs text-zinc-400">6. Security Advisor Health</div>
          <div className="text-2xl font-mono font-bold text-white">
            <span
              className={`rounded px-1.5 py-0.5 text-sm ${
                securityAdvisorStatus === 'CLEAN' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
              }`}
            >
              {securityAdvisorStatus}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            Definer: {snapshot.database.securityAdvisor.securityDefinerCount} / RLS: {snapshot.database.securityAdvisor.rlsNoPolicyCount}
          </div>
        </div>

        {/* Dim 7: Meta Readiness */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-1 md:col-span-2">
          <div className="text-xs text-zinc-400">7. Meta Public Readiness & Capabilities</div>
          <div className="text-sm font-mono font-semibold text-emerald-400 mt-1">
            Mode: {snapshot.database.metaReadiness.mode}
          </div>
          <div className="text-[11px] text-zinc-400">
            Data Deletion Callback:{' '}
            {snapshot.database.metaReadiness.dataDeletionCallbackActive ? 'Active (정상)' : 'Inactive'}
          </div>
        </div>
      </div>
    </div>
  )
}
