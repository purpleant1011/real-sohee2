'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Server,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Cpu,
  Share2,
  MessageSquare,
  Search,
  Globe,
  Radio,
  ExternalLink,
  History,
} from 'lucide-react';

export interface ThirdPartyComponent {
  componentId: string;
  name: string;
  category: string;
  license: string;
  pinnedVersion: string;
  sourceUrl: string;
  health: 'OK' | 'DEGRADED' | 'STALE' | 'DOWN';
  isExecutable: boolean;
  lastSuccessTimestamp?: string;
  lastErrorTimestamp?: string;
}

export interface AdminAuditLog {
  auditId: string;
  adminActorId: string;
  action: string;
  target: string;
  reason: string;
  timestamp: string;
}

export function WingStackMonitorCard() {
  const [components, setComponents] = useState<ThirdPartyComponent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [isGlobalKill, setIsGlobalKill] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isolatedTargets, setIsolatedTargets] = useState<Set<string>>(new Set());

  const fetchWingStackStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/system/wing-stack');
      if (res.ok) {
        const data = await res.json();
        setComponents(data.components || []);
        setAuditLogs(data.auditLogs || []);
        setIsGlobalKill(Boolean(data.isGlobalKillActive));
      }
    } catch (err) {
      console.warn('WingStack fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWingStackStatus();
  }, [fetchWingStackStatus]);

  const handleToggleIsolate = async (componentId: string, currentHealth: string) => {
    const isCurrentlyIsolated = isolatedTargets.has(componentId) || currentHealth === 'DOWN';
    const action = isCurrentlyIsolated ? 'RELEASE_KILL_SWITCH' : 'TRIGGER_KILL_SWITCH';
    const reason = prompt(
      isCurrentlyIsolated
        ? `[${componentId}] 격리를 해제하고 정상 연동을 재개하시겠습니까? 사유를 입력하세요:`
        : `[${componentId}] 해당 프로바이더를 즉시 격리(차단)하시겠습니까? 긴급 격리 사유를 입력하세요:`,
      isCurrentlyIsolated ? '상태 정상화 확인 후 복구' : '오류 급증 및 서킷 이상 탐지로 인한 긴급 격리'
    );

    if (!reason || reason.trim().length === 0) return;

    setIsProcessing(true);
    try {
      const res = await fetch('/api/admin/system/wing-stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          scope: 'PROVIDER',
          target: componentId,
          reason,
        }),
      });

      if (res.ok) {
        setIsolatedTargets((prev) => {
          const next = new Set(prev);
          if (isCurrentlyIsolated) next.delete(componentId);
          else next.add(componentId);
          return next;
        });
        await fetchWingStackStatus();
      } else {
        const err = await res.json();
        alert(`격리 조치 실패: ${err.error || '권한 부족'}`);
      }
    } catch (e: any) {
      alert(`네트워크 오류: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'RUNTIME_ENGINE':
        return <Cpu className="size-4 text-cyan-400" />;
      case 'INTEGRATION_FABRIC':
        return <Radio className="size-4 text-emerald-400" />;
      case 'SOCIAL_PUBLISH':
        return <Share2 className="size-4 text-indigo-400" />;
      case 'CONVERSATION_BUS':
        return <MessageSquare className="size-4 text-pink-400" />;
      case 'AD_MCP':
        return <Search className="size-4 text-amber-400" />;
      case 'BROWSER_WORKER':
        return <Globe className="size-4 text-violet-400" />;
      default:
        return <Server className="size-4 text-slate-400" />;
    }
  };

  const healthyCount = components.filter(
    (c) => c.health === 'OK' && !isolatedTargets.has(c.componentId)
  ).length;

  return (
    <Card className="p-6 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-xl text-slate-100 font-sans space-y-6">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Server className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Wing Stack 서드파티 인프라 & MCP 관제탑 (Third-Party Substrates)
                </h3>
                <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30 bg-cyan-500/10 font-mono">
                  ANI-775
                </Badge>
              </div>
              <p className="text-xs text-slate-400">
                오픈소스 SBOM 버전 잠금 · 실시간 카나리 헬스 · 프로바이더별 1클릭 격리 킬스위치
              </p>
            </div>
          </div>
        </div>

        {/* Global Stats & Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs">
            <span className="flex size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-medium">
              정상 가동: <b className="text-white font-mono">{healthyCount}</b> / {components.length}
            </span>
          </div>

          {isGlobalKill ? (
            <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 gap-1 text-xs">
              <ShieldAlert className="size-3.5" /> 전역 킬스위치 차단 중
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1 text-xs">
              <ShieldCheck className="size-3.5" /> Fail-Closed 보호 활성
            </Badge>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={fetchWingStackStatus}
            disabled={isLoading}
            className="h-8 px-2.5 text-xs text-slate-400 hover:text-white"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 2. Component Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {components.map((comp) => {
          const isIsolated = isolatedTargets.has(comp.componentId) || comp.health === 'DOWN';
          return (
            <div
              key={comp.componentId}
              className={`p-4 rounded-2xl border transition-all duration-200 ${
                isIsolated
                  ? 'bg-rose-950/20 border-rose-800/40 shadow-inner'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
                    {getCategoryIcon(comp.category)}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">{comp.name}</h4>
                    <span className="text-[10px] text-slate-500 font-mono">{comp.componentId}</span>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono px-2 py-0.5 ${
                    isIsolated
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : comp.health === 'OK'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {isIsolated ? 'ISOLATED' : comp.health}
                </Badge>
              </div>

              {/* Version & License Specs */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-900/50 p-2 rounded-xl border border-slate-800/50">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">버전 (Pinned)</span>
                  <span className="font-mono text-slate-200 font-medium">{comp.pinnedVersion}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">라이선스 (SBOM)</span>
                  <span className="font-mono text-slate-200">{comp.license}</span>
                </div>
              </div>

              {/* Action Controls */}
              <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                <a
                  href={comp.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
                >
                  <span>Repository</span>
                  <ExternalLink className="size-2.5" />
                </a>

                <Button
                  size="sm"
                  variant={isIsolated ? 'default' : 'outline'}
                  disabled={isProcessing}
                  onClick={() => handleToggleIsolate(comp.componentId, comp.health)}
                  className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg transition-all ${
                    isIsolated
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'border-slate-700 hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/40 text-slate-300'
                  }`}
                >
                  {isIsolated ? '격리 해제 (Restore)' : '긴급 격리 (Isolate)'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Audit Trail Footer */}
      {auditLogs.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2">
            <History className="size-3.5 text-indigo-400" />
            <span>최근 특권 통제 감사 이력 (Immutable Admin Audit Lineage)</span>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-1.5 pr-2">
            {auditLogs.slice(-3).reverse().map((log) => (
              <div
                key={log.auditId}
                className="text-[11px] font-mono p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-slate-400"
              >
                <div>
                  <span className="text-indigo-400 font-bold">[{log.action}]</span>{' '}
                  <span className="text-slate-200">{log.target}</span>: {log.reason}
                </div>
                <div className="text-[10px] text-slate-500">
                  {log.timestamp.slice(11, 19)} ({log.adminActorId})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
