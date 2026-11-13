'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Info,
  XCircle,
} from 'lucide-react';
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SPEC_RULES_METADATA } from '@/features/vault/channel-spec/spec-table';
import type {
  ChannelType,
  CheckStatus,
  EvidenceType,
  SpecCheckResult,
  SpecEvaluationResult,
} from '@/features/vault/channel-spec/types';
import { cn } from '@/lib/utils';
import { getResolutionAction } from './resolution-actions';

export interface SpecCheckPanelProps {
  readonly result: SpecEvaluationResult;
  readonly channel?: ChannelType;
  readonly initialExpanded?: boolean;
  readonly className?: string;
}

const CHANNEL_NAMES: Readonly<Record<ChannelType, string>> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈니스',
};

export const EVIDENCE_LABELS: Readonly<Record<EvidenceType, string>> = {
  OFFICIAL_DOC: '공식 문서 기준',
  CONFIG: '소희 기본 설정',
  UNVERIFIED: '확인이 필요해요',
};

export const STATUS_LABELS: Readonly<Record<CheckStatus, string>> = {
  PASS: '통과',
  WARN: '주의',
  FAIL: '수정 필요',
  UNKNOWN: '확인 불가',
};

function StatusIndicator({ status }: { readonly status: CheckStatus }) {
  switch (status) {
    case 'PASS':
      return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-state-ok bg-state-ok-soft border border-state-ok/40">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-state-ok" aria-hidden="true" />
          <span>{STATUS_LABELS.PASS}</span>
        </span>
      );
    case 'WARN':
      return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-state-warn bg-state-warn-soft border border-state-warn/40">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-state-warn" aria-hidden="true" />
          <span>{STATUS_LABELS.WARN}</span>
        </span>
      );
    case 'FAIL':
      return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-state-danger bg-state-danger-soft border border-state-danger/40">
          <XCircle className="h-3.5 w-3.5 shrink-0 text-state-danger" aria-hidden="true" />
          <span>{STATUS_LABELS.FAIL}</span>
        </span>
      );
    case 'UNKNOWN':
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-zinc-800 bg-zinc-100 dark:text-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
          <HelpCircle className="h-3.5 w-3.5 shrink-0 text-zinc-600 dark:text-zinc-400" aria-hidden="true" />
          <span>{STATUS_LABELS.UNKNOWN}</span>
        </span>
      );
  }
}

function CheckItem({ item }: { readonly item: SpecCheckResult }) {
  const meta = SPEC_RULES_METADATA[item.id];
  const sourceUrl = meta?.sourceUrl;
  const resolutionAction = getResolutionAction(item.id);
  const isFail = item.status === 'FAIL';

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusIndicator status={item.status} />
          <span className="break-words text-sm font-semibold text-foreground">
            {item.label}
          </span>
          <Badge
            variant="outline"
            className="border-border bg-muted/50 text-xs text-muted-foreground font-normal"
          >
            {EVIDENCE_LABELS[item.evidence]}
          </Badge>
        </div>

        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.label} 근거 보기 (새 창에서 열림)`}
            className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[28px] py-1 px-1"
          >
            <span>근거 보기</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          </a>
        )}
      </div>

      {item.userMessage && (
        <p className="break-words text-xs text-muted-foreground leading-relaxed">
          {item.userMessage}
        </p>
      )}

      {isFail && (
        <div className="rounded-md border border-state-danger/30 bg-state-danger-soft p-2.5">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-state-danger"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-0.5">
              <span className="block text-xs font-semibold text-state-danger">
                해결 행동
              </span>
              <p className="break-words text-xs text-state-danger">
                {resolutionAction}
              </p>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function SpecCheckPanel({
  result,
  channel,
  initialExpanded,
  className,
}: SpecCheckPanelProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(
    initialExpanded ?? result.blocksVault
  );

  const failCount = result.checks.filter((c) => c.status === 'FAIL').length;
  const isBlocked = result.blocksVault || failCount > 0;
  const hasUnverifiedOrUnknown = result.checks.some(
    (c) => c.evidence === 'UNVERIFIED' || c.status === 'UNKNOWN'
  );

  const channelLabel = channel ? CHANNEL_NAMES[channel] : null;

  return (
    <Card
      className={cn(
        'w-full min-w-0 overflow-hidden border border-border bg-card p-3 sm:p-4 text-card-foreground',
        className
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {channelLabel && (
              <span className="text-xs font-medium text-muted-foreground">
                {channelLabel}
              </span>
            )}
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-bold',
                isBlocked
                  ? 'text-state-danger'
                  : 'text-state-ok'
              )}
            >
              {isBlocked ? (
                <>
                  <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>고쳐야 할 게 {failCount > 0 ? failCount : 1}개 있어요</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>보관할 수 있어요</span>
                </>
              )}
            </div>
          </div>
          <p className="break-words text-xs text-muted-foreground">
            {isBlocked
              ? '채널 규격에 맞지 않는 항목이 있어 보관하기 전에 수정이 필요해요.'
              : '채널 규격을 모두 확인했어요.'}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          aria-controls="spec-check-items-list"
          aria-label={isExpanded ? '검사 항목 접기' : '검사 항목 펼치기'}
          className="min-h-[44px] shrink-0 gap-1 px-3 text-xs text-foreground"
        >
          <span>{isExpanded ? '상세 접기' : '상세 보기'}</span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
        </Button>
      </div>

      {isExpanded && (
        <div id="spec-check-items-list" className="mt-3 border-t border-border pt-3">
          {hasUnverifiedOrUnknown && (
            <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground border border-border/50">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="break-words leading-relaxed">
                확인이 필요하거나 미검증된 항목은 보관을 막지 않아요
              </p>
            </div>
          )}

          <ul role="list" className="divide-y divide-border/60">
            {result.checks.map((item) => (
              <CheckItem key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
