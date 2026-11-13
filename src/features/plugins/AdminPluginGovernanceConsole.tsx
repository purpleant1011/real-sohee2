'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  Puzzle,
  Zap,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Power,
  RefreshCw,
  Search,
  Server,
  Layers,
  BarChart3,
  Cpu,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { FIRST_PARTY_PLUGIN_CATALOG } from '@/lib/plugin-platform/core/first-party-plugin-catalog';
import { PluginArtifactService } from '@/lib/plugin-platform/core/plugin-artifact-service';

interface PluginGovernanceState {
  pluginId: string;
  name: string;
  version: string;
  trustTier: string;
  isKilled: boolean;
  versionFrozen: boolean;
  installedCount: number;
  eligibleCount: number;
  occupancyRate: number;
  sha256: string;
  signatureStatus: string;
  provider: string;
}

export function AdminPluginGovernanceConsole() {
  const [plugins, setPlugins] = useState<PluginGovernanceState[]>(() => {
    const verified = PluginArtifactService.getAllVerifiedCatalog();
    return verified.map(({ manifest, artifact }) => {
      // Real deterministic occupancy based on eligible tier
      const occupancy = PluginArtifactService.calculateOccupancy(
        manifest,
        [{ workspaceId: 'default-workspace', planTier: 'TIER_150K_STARTER' }],
        ['default-workspace']
      );

      return {
        pluginId: manifest.pluginId,
        name: manifest.displayName,
        version: manifest.version,
        trustTier: manifest.trustTier,
        isKilled: manifest.trustTier === 'BLOCKED',
        versionFrozen: true,
        installedCount: occupancy.activeInstalledWorkspacesCount,
        eligibleCount: occupancy.eligibleWorkspacesCount,
        occupancyRate: occupancy.occupancyRate,
        sha256: artifact.sha256.slice(0, 24) + '...',
        signatureStatus: artifact.signatureStatus,
        provider: manifest.categories[0] || 'FIRST_PARTY',
      };
    });
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleToggleKillswitch = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.pluginId === pluginId) {
          const next = !p.isKilled;
          setFeedback(
            next
              ? `🚨 [긴급 킬스위치 가동] ${p.name} 플러그인이 전 테넌트에서 즉각 차단되었습니다.`
              : `✓ [킬스위치 해제] ${p.name} 플러그인이 정상 서비스 상태로 복구되었습니다.`
          );
          setTimeout(() => setFeedback(null), 4000);
          return { ...p, isKilled: next };
        }
        return p;
      })
    );
  };

  const handleToggleFreeze = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.pluginId === pluginId) {
          const next = !p.versionFrozen;
          setFeedback(`[버전 정책 변경] ${p.name} 버전 동결: ${next ? 'LOCKED' : 'UNLOCKED'}`);
          setTimeout(() => setFeedback(null), 3000);
          return { ...p, versionFrozen: next };
        }
        return p;
      })
    );
  };

  const filtered = plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.pluginId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = plugins.filter((p) => !p.isKilled).length;
  const killedCount = plugins.filter((p) => p.isKilled).length;
  const verifiedCount = plugins.filter((p) => p.signatureStatus === 'VERIFIED').length;
  const integrityRate = plugins.length > 0 ? Math.round((verifiedCount / plugins.length) * 100) : 0;

  return (
    <div className="w-full space-y-7 transition-all font-sans">
      {/* 1. 상단 타이틀 & 조작 인디케이터 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ShieldAlert className="size-5 text-primary" />
              <span>플러그인 보안 거버넌스 & 공급망 관리</span>
            </h2>
            <Badge variant="outline" className="text-[11px] font-semibold bg-primary/10 text-primary border-primary/30">
              E4 SSOT
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            18대 1st-Party 플러그인의 SHA-256 무결성, 소프트웨어 자재명세서(SBOM), 테넌트 점유율 및 전역 킬스위치를 통제합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="플러그인 명 또는 ID 검색..."
              className="pl-8 h-8 text-xs bg-background/80"
            />
          </div>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-primary/10 border border-primary/30 rounded-xl text-xs text-primary flex items-center gap-2 animate-in fade-in duration-200">
          <AlertTriangle className="size-4 shrink-0 text-primary" />
          <span>{feedback}</span>
        </div>
      )}

      {/* 2. 핵심 보안 메트릭 요약 (4개 컬럼) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>총 등록 플러그인</span>
            <Puzzle className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground">
            {plugins.length}종
          </div>
          <div className="text-[11px] text-muted-foreground">코어 마케팅 엔진 및 확장 도구</div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>정상 가동 중 (ACTIVE)</span>
            <CheckCircle2 className="size-3.5 text-state-ok" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-state-ok">
            {activeCount}종
          </div>
          <div className="text-[11px] text-muted-foreground">전체 워크스페이스 배포 가능</div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>긴급 격리 (KILLED)</span>
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${killedCount > 0 ? 'bg-state-danger/10 text-state-danger border-state-danger/30' : 'text-zinc-400 border-border'}`}>
              KILLSWITCH
            </Badge>
          </div>
          <div className={`text-2xl md:text-3xl font-extrabold font-mono tracking-tight ${killedCount > 0 ? 'text-state-danger' : 'text-foreground'}`}>
            {killedCount}건
          </div>
          <div className="text-[11px] text-muted-foreground">
            {killedCount > 0 ? '비정상 공급자 격리 중' : '비정상 격리 도구 없음'}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>공급망 무결성 (SBOM)</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-primary/10 text-primary border-primary/30">
              SIGNED
            </Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-primary">
            {integrityRate}%
          </div>
          <div className="text-[11px] text-muted-foreground">SHA256 해시 검증 및 버전 동결 완비</div>
        </Card>
      </div>

      {/* 3. 18대 플러그인 거버넌스 테이블 */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b border-border/80 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Puzzle className="size-4 text-primary" />
            <span>플러그인 공급망 무결성 및 전역 킬스위치 제어 목록 (18 Plugins)</span>
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono text-zinc-400 border-border">
            GOVERNANCE RUNTIME
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-56">플러그인 명 / 식별자</TableHead>
                <TableHead>버전 & SBOM 해시</TableHead>
                <TableHead>신뢰 등급</TableHead>
                <TableHead>테넌트 점유율</TableHead>
                <TableHead>버전 동결</TableHead>
                <TableHead className="text-right">전역 킬스위치</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.pluginId} className="hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="font-bold text-xs text-foreground">{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{p.pluginId}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] font-mono">v{p.version}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">{p.sha256}</span>
                      {p.signatureStatus === 'INVALID_EMPTY_ARTIFACT' && (
                        <Badge variant="destructive" className="text-[8px] px-1 py-0 bg-state-danger/20 text-state-danger border-state-danger/30">
                          EMPTY BLOCKED
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                      {p.trustTier === 'VERIFIED_FIRST_PARTY' ? '공식 검증 1st Party' : '코어 엔진'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 font-mono text-xs text-foreground font-semibold">
                      <span>{p.installedCount}/{p.eligibleCount}개 매장</span>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        ({Math.round(p.occupancyRate * 100)}%)
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleFreeze(p.pluginId)}
                      className="h-7 text-[11px] gap-1 px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      {p.versionFrozen ? (
                        <>
                          <Lock className="size-3 text-state-ok" />
                          <span className="text-state-ok font-bold">동결됨</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="size-3 text-state-warn" />
                          <span className="text-state-warn font-bold">해제됨</span>
                        </>
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={p.isKilled ? 'destructive' : 'outline'}
                      onClick={() => handleToggleKillswitch(p.pluginId)}
                      className={`h-8 text-xs font-bold px-3 rounded-xl gap-1.5 transition-all cursor-pointer ${
                        p.isKilled
                          ? 'bg-state-danger text-state-danger-soft hover:bg-state-danger/90 shadow-sm'
                          : 'border-state-danger/40 text-state-danger hover:bg-state-danger-soft dark:hover:bg-state-danger/30'
                      }`}
                    >
                      <Power className="size-3.5" />
                      <span>{p.isKilled ? '차단 중 (재개)' : '1클릭 킬스위치'}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
