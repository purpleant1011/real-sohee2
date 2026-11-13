'use client'

import React from 'react'
import { ShieldCheck, ShieldAlert, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react'

export interface ProductionReadinessCardProps {
  appId: string
  appMode: 'development' | 'live' | string
  accessLevel: 'standard' | 'advanced' | string
  reviewStatus: 'unsubmitted' | 'pending' | 'approved' | 'rejected' | string
  audience: 'TEST_ROLE_ONLY' | 'PRODUCTION_DELEGATED' | string
  isProductionReady: boolean
  lastVerifiedAt?: string | null
}

export function ProductionReadinessCard({
  appId,
  appMode,
  accessLevel,
  reviewStatus,
  audience,
  isProductionReady,
  lastVerifiedAt,
}: ProductionReadinessCardProps) {
  return (
    <div className={`p-6 rounded-3xl border transition-all ${
      isProductionReady
        ? 'bg-state-ok/40 border-state-ok/40'
        : 'bg-white dark:bg-zinc-950 border-state-warn/40 shadow-xs'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl ${
            isProductionReady
              ? 'bg-state-ok-soft text-state-ok dark:bg-state-ok/60 dark:text-state-ok'
              : 'bg-state-warn-soft text-state-warn dark:bg-state-warn/60 dark:text-state-warn'
          }`}>
            {isProductionReady ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
              <span>Meta 플랫폼 실제 운영 연동 준비 상태</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                isProductionReady
                  ? 'bg-state-ok text-white'
                  : 'bg-state-warn text-white'
              }`}>
                {isProductionReady ? '연동 준비 완료' : '준비 중 (테스트 모드)'}
              </span>
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              연결·준비·자율 운영 단계 원칙에 따른 Meta 앱 심사 및 권한 기준입니다.
            </p>
          </div>
        </div>

        <div className="text-right font-mono text-xs text-zinc-400">
          <div>앱 등록 번호: {appId}</div>
          {lastVerifiedAt && <div className="text-[10px]">검증: {lastVerifiedAt}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
          <div className="text-[11px] font-bold text-zinc-400">앱 동작 모드</div>
          <div className="text-xs font-black text-zinc-800 dark:text-zinc-200 mt-1 uppercase">
            {appMode === 'live' ? '🟢 실제 운영 (LIVE)' : '🟡 테스트 모드 (개발 중)'}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
          <div className="text-[11px] font-bold text-zinc-400">권한 접근 수준</div>
          <div className="text-xs font-black text-zinc-800 dark:text-zinc-200 mt-1 uppercase">
            {accessLevel === 'advanced' ? '고급 권한' : '기본 권한 (제한적)'}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
          <div className="text-[11px] font-bold text-zinc-400">공식 앱 심사 상태</div>
          <div className="text-xs font-black text-zinc-800 dark:text-zinc-200 mt-1 uppercase">
            {reviewStatus === 'approved' ? '승인 완료' : `검토 대기 (${reviewStatus})`}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
          <div className="text-[11px] font-bold text-zinc-400">계정 로그인 연결 대상</div>
          <div className="text-xs font-black text-zinc-800 dark:text-zinc-200 mt-1 uppercase">
            {audience === 'TEST_ROLE_ONLY' ? '테스터 계정만' : audience === 'PRODUCTION_DELEGATED' ? '전체 사장님' : audience}
          </div>
        </div>
      </div>

      {!isProductionReady && (
        <div className="mt-4 p-3 rounded-xl bg-state-warn-soft border border-state-warn/30 text-xs text-state-warn flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-state-warn" />
          <span>
            현재 Meta 앱이 준비 중인 상태이므로 등록된 테스트 계정에서만 연결해 볼 수 있으며, 일반 사장님 계정의 연결은 안전을 위해 순차적으로 열립니다.
          </span>
        </div>
      )}
    </div>
  )
}
