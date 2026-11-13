'use client';

/**
 * Sohee V0.8.9 / V0.9 Admin Exception & Reconcile Control Plane
 * Exception Reconcile Queue (ANI-987)
 * 
 * Invariants:
 * 1. Prohibits blind retries on RESULT_UNKNOWN or unverified actions.
 * 2. Only safe Reconcile (readback/probe/ledger verification) CTAs are permitted.
 * 3. Handles 4 canonical operational exception classes:
 *    - RESULT_UNKNOWN
 *    - PROVIDER_UNPROBED
 *    - AUTH_REVOKED
 *    - BUDGET_EXCEEDED
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { channelLabel, formatKst, referenceCode } from '@/components/admin-ui/labels';
import {
  AlertTriangle,
  HelpCircle,
  ShieldAlert,
  Coins,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Filter,
  Check,
} from 'lucide-react';

export type ExceptionType =
  | 'RESULT_UNKNOWN'
  | 'PROVIDER_UNPROBED'
  | 'AUTH_REVOKED'
  | 'BUDGET_EXCEEDED';

export interface ExceptionQueueItem {
  id: string;
  actionRunId: string;
  workspaceId: string;
  workspaceName?: string;
  channel?: string;
  capabilityId?: string;
  type: ExceptionType;
  title: string;
  detail: string;
  occurredAt: string;
  status: 'PENDING_RECONCILE' | 'RECONCILING' | 'RESOLVED';
  reconcileActionLabel: string;
}

export const DEFAULT_EXCEPTION_ITEMS: ExceptionQueueItem[] = [
  {
    id: 'exc-001',
    actionRunId: 'act-run-unknown-101',
    workspaceId: 'ws-gangnam-01',
    workspaceName: '강남 피부과',
    channel: 'INSTAGRAM',
    capabilityId: 'mcp_post_instagram_carousel',
    type: 'RESULT_UNKNOWN',
    title: '인스타그램 피드 발행 후 타임아웃 (RESULT_UNKNOWN)',
    detail: '외부 Meta Graph API 504 Gateway Timeout 발생. 이중 포스팅 위험으로 Blind Retry는 차단되었으며, 독립 Readback 대사가 필요합니다.',
    occurredAt: '2026-09-07T03:15:00Z',
    status: 'PENDING_RECONCILE',
    reconcileActionLabel: '독립 Readback 안전 대사 (Reconcile)',
  },
  {
    id: 'exc-002',
    actionRunId: 'act-run-unprobed-102',
    workspaceId: 'ws-seocho-02',
    workspaceName: '서초 클리닉',
    channel: 'NAVER_BLOG',
    capabilityId: 'mcp_post_naver_blog',
    type: 'PROVIDER_UNPROBED',
    title: '네이버 블로그 세션 상태 미확인 (PROVIDER_UNPROBED)',
    detail: '스마트에디터 세션 핑 실패. 작업 디스패치 전 사전 상태 Probe 대사가 필요합니다.',
    occurredAt: '2026-09-07T03:18:00Z',
    status: 'PENDING_RECONCILE',
    reconcileActionLabel: '프로바이더 상태 Probe 대사',
  },
  {
    id: 'exc-003',
    actionRunId: 'act-run-auth-103',
    workspaceId: 'ws-songpa-03',
    workspaceName: '송파 뷰티',
    channel: 'THREADS',
    capabilityId: 'mcp_post_threads_update',
    type: 'AUTH_REVOKED',
    title: '스레드 인증 토큰 만료 (AUTH_REVOKED)',
    detail: 'OAuth 리프레시 토큰 만료로 외부 인가 실패. 세션 재검증이 필요합니다.',
    occurredAt: '2026-09-07T03:20:00Z',
    status: 'PENDING_RECONCILE',
    reconcileActionLabel: '인가 세션 재검증 대사',
  },
  {
    id: 'exc-004',
    actionRunId: 'act-run-budget-104',
    workspaceId: 'ws-mapo-04',
    workspaceName: '마포 스킨',
    channel: 'META_ADS',
    capabilityId: 'mcp_dispatch_meta_ads',
    type: 'BUDGET_EXCEEDED',
    title: '일일 광고 예산 한도 초과 (BUDGET_EXCEEDED)',
    detail: '설정된 일일 상한 50,000 KRW 도달. FinOps 원장 대사 및 안전 정지가 적용되었습니다.',
    occurredAt: '2026-09-07T03:22:00Z',
    status: 'PENDING_RECONCILE',
    reconcileActionLabel: 'FinOps 예산 원장 대사',
  },
];

interface ExceptionReconcileQueueProps {
  items?: ExceptionQueueItem[];
  onReconcile?: (item: ExceptionQueueItem) => Promise<void> | void;
  className?: string;
}

export function ExceptionReconcileQueue({
  items = DEFAULT_EXCEPTION_ITEMS,
  onReconcile,
  className = '',
}: ExceptionReconcileQueueProps) {
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reconcilingIds, setReconcilingIds] = useState<Set<string>>(new Set());
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  const handleReconcileClick = async (item: ExceptionQueueItem) => {
    setReconcilingIds((prev) => new Set(prev).add(item.id));
    try {
      if (onReconcile) {
        await onReconcile(item);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      setResolvedIds((prev) => new Set(prev).add(item.id));
    } finally {
      setReconcilingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesFilter = activeFilter === 'ALL' || item.type === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q) ||
      item.actionRunId.toLowerCase().includes(q) ||
      (item.workspaceName && item.workspaceName.toLowerCase().includes(q)) ||
      (item.channel && item.channel.toLowerCase().includes(q));
    return matchesFilter && matchesSearch;
  });

  const getBadgeVariant = (type: ExceptionType) => {
    switch (type) {
      case 'RESULT_UNKNOWN':
        return 'warning';
      case 'PROVIDER_UNPROBED':
        return 'outline';
      case 'AUTH_REVOKED':
        return 'destructive';
      case 'BUDGET_EXCEEDED':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const getIcon = (type: ExceptionType) => {
    switch (type) {
      case 'RESULT_UNKNOWN':
        return <HelpCircle className="size-4 text-state-warn shrink-0" />;
      case 'PROVIDER_UNPROBED':
        return <AlertTriangle className="size-4 text-state-warn shrink-0" />;
      case 'AUTH_REVOKED':
        return <ShieldAlert className="size-4 text-destructive shrink-0" />;
      case 'BUDGET_EXCEEDED':
        return <Coins className="size-4 text-state-danger shrink-0" />;
    }
  };

  return (
    <Card className={`overflow-hidden border-border/80 shadow-xs ${className}`} data-testid="exception-reconcile-queue">
      <CardHeader className="bg-muted/20 border-b pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-state-warn" />
              <CardTitle className="text-base md:text-lg font-bold">
                운영 예외 및 안전 대사 큐
              </CardTitle>
              <Badge variant="outline" className="text-xs font-mono font-bold bg-state-warn/10 text-state-warn border-state-warn/30">
                중복 재시도 원천 차단
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              결과 불확실, 인증 만료, 프로바이더 미확인 등 이상 상태를 임의 재시도 없이 독립 검증으로 안전하게 대사합니다.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="예외 검색 (ID, 채널, 워크스페이스)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-background"
              />
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          {['ALL', 'RESULT_UNKNOWN', 'PROVIDER_UNPROBED', 'AUTH_REVOKED', 'BUDGET_EXCEEDED'].map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                activeFilter === filter
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground space-y-2">
            <CheckCircle2 className="size-8 mx-auto text-state-ok" />
            <p className="text-sm font-semibold">대기 중인 예외 대사 항목이 없습니다.</p>
            <p className="text-xs text-muted-foreground">모든 액션런이 정상 검증되었거나 대사가 완료되었습니다.</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isReconciling = reconcilingIds.has(item.id);
            const isResolved = resolvedIds.has(item.id);

            return (
              <div
                key={item.id}
                data-testid={`exception-item-${item.id}`}
                className={`p-4 rounded-xl border transition-all ${
                  isResolved
                    ? 'bg-state-ok/5 border-state-ok/30'
                    : 'bg-card hover:border-primary/40 border-border/80 shadow-xs'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getIcon(item.type)}
                      <Badge variant={getBadgeVariant(item.type)} className="text-[11px] font-bold">
                        {item.type}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground font-semibold">
                        참조번호 {referenceCode(item.actionRunId)}
                      </span>
                      {item.workspaceName && (
                        <Badge variant="outline" className="text-[10px]">
                          {item.workspaceName}
                        </Badge>
                      )}
                      {item.channel && (
                        <Badge variant="purple" className="text-[10px]">
                          {channelLabel(item.channel)}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto lg:ml-0">
                        {formatKst(item.occurredAt)}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-foreground">{item.title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
                  </div>

                  {/* Action Reconcile CTA (STRICT INVARIANT: No blind retry buttons permitted) */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0">
                    {isResolved ? (
                      <div className="flex items-center gap-1.5 text-xs text-state-ok font-semibold px-3 py-1.5 rounded-lg bg-state-ok/10 border border-state-ok/20">
                        <Check className="size-3.5" /> 대사 완료
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant={item.type === 'RESULT_UNKNOWN' ? 'default' : 'outline'}
                        onClick={() => handleReconcileClick(item)}
                        disabled={isReconciling}
                        data-testid={`btn-reconcile-${item.id}`}
                        className="min-h-11 text-xs font-semibold gap-1.5 shadow-xs transition-transform active:scale-95"
                      >
                        {isReconciling ? (
                          <>
                            <RefreshCw className="size-3.5 animate-spin" />
                            대사 처리 중...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="size-3.5" />
                            {item.reconcileActionLabel}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
