'use client'

import React from 'react'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Capability, LearningPlatform, LearningSource } from '../contracts'

export interface ChannelSourceCardProps {
  source: LearningSource
  capability?: Capability
  canManage: boolean
  onVerify: (source: LearningSource) => void
  onCollect: (source: LearningSource) => void
  onReview: (source: LearningSource) => void
  onCancel: (source: LearningSource) => void
  onDelete: (source: LearningSource) => void
}

const PLATFORM_INFO: Record<
  LearningPlatform,
  { name: string; icon: React.ComponentType<{ className?: string }> }
> = {
  instagram: { name: '인스타그램', icon: Camera },
  threads: { name: '스레드', icon: Globe },
  naver_blog: { name: '네이버 블로그', icon: Globe },
  naver_place: { name: '네이버 플레이스', icon: Globe },
  daangn_business: { name: '당근 비즈프로필', icon: Globe },
  website: { name: '웹사이트', icon: Globe },
}

const VERIFICATION_LABELS: Record<
  LearningSource['verification'],
  { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }
> = {
  pending: { label: '확인 대기 중', variant: 'warning' },
  verified: { label: '본인 확인 완료', variant: 'success' },
  expired: { label: '인증 만료됨', variant: 'secondary' },
  revoked: { label: '인증 취소됨', variant: 'destructive' },
  failed: { label: '확인 실패', variant: 'destructive' },
}

const COLLECTION_LABELS: Record<
  LearningSource['collection'],
  { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }
> = {
  blocked: { label: '수집 차단됨', variant: 'secondary' },
  queued: { label: '수집 대기 중', variant: 'secondary' },
  collecting: { label: '수집 중…', variant: 'secondary' },
  extracting: { label: '지식 분석 중…', variant: 'secondary' },
  review_required: { label: '검토 필요', variant: 'warning' },
  partial: { label: '일부 수집됨', variant: 'warning' },
  failed: { label: '수집 실패', variant: 'destructive' },
  cancelled: { label: '수집 취소됨', variant: 'secondary' },
}

function checkLeaseExpired(lease: LearningSource['lease']): boolean {
  if (!lease || Boolean(lease.revokedAt)) return true
  try {
    return new Date(lease.expiresAt).getTime() <= Date.now()
  } catch {
    return true
  }
}

export function ChannelSourceCard({
  source,
  capability,
  canManage,
  onVerify,
  onCollect,
  onReview,
  onCancel,
  onDelete,
}: ChannelSourceCardProps) {
  const platform = PLATFORM_INFO[source.platform] ?? {
    name: source.platform,
    icon: Globe,
  }
  const Icon = platform.icon
  const collection = COLLECTION_LABELS[source.collection]

  const isBlocked = capability?.collectionMode === 'blocked'
  const isManualOnly = capability?.collectionMode === 'manual_only'

  // lease 유효성 엄격 검증: verified여도 lease가 없거나 만료/취소됐으면 미인증 처리
  const isLeaseExpiredOrRevoked = checkLeaseExpired(source.lease)

  const isVerified = source.verification === 'verified' && !isLeaseExpiredOrRevoked

  const verification: { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' } =
    source.verification === 'verified' && isLeaseExpiredOrRevoked
      ? { label: '인증 만료됨 (재확인 필요)', variant: 'warning' }
      : VERIFICATION_LABELS[source.verification]
  const isCollecting = source.collection === 'collecting' || source.collection === 'extracting'
  const hasReviewCandidates = source.collection === 'review_required' || source.collection === 'partial'

  return (
    <Card className="p-4 sm:p-5 rounded-2xl border border-border/80 bg-card shadow-xs space-y-3.5 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* 플랫폼 및 URL */}
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">{platform.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                @{source.canonicalIdentity}
              </span>
            </div>
            <a
              href={source.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 truncate max-w-full mt-0.5"
            >
              <span className="truncate">{source.canonicalUrl}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </div>
        </div>

        {/* 상태 뱃지 그룹 */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto flex-wrap">
          <Badge
            variant={verification.variant}
            className={`text-[11px] font-semibold ${
              verification.variant === 'warning'
                ? 'text-amber-900 dark:text-amber-200'
                : verification.variant === 'success'
                  ? 'text-emerald-900 dark:text-emerald-200'
                  : ''
            }`}
          >
            {verification.label}
          </Badge>
          <Badge
            variant={collection.variant}
            className={`text-[11px] font-semibold ${
              collection.variant === 'warning'
                ? 'text-amber-900 dark:text-amber-200'
                : collection.variant === 'success'
                  ? 'text-emerald-900 dark:text-emerald-200'
                  : ''
            }`}
          >
            {collection.label}
          </Badge>
        </div>
      </div>

      {/* 특수 플랫폼 및 차단 정직 안내 */}
      {isManualOnly && (
        <div className="p-3 rounded-xl bg-muted/60 border border-border text-xs text-muted-foreground flex items-start gap-2">
          <AlertCircle className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
          <p className="leading-relaxed">
            네이버 블로그/플레이스는 네이버 정책상 자동 수집을 지원하지 않으며, 직접 입력한 내용이나 공개 정책을 검토합니다.
          </p>
        </div>
      )}

      {isBlocked && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" aria-hidden />
          <p className="leading-relaxed">
            공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다. 향후 공식 지원 시 안내해 드립니다.
          </p>
        </div>
      )}

      {source.collection === 'cancelled' && (
        <div className="p-3 rounded-xl bg-muted/60 border border-border text-xs text-muted-foreground flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
          <p className="leading-relaxed">
            수집이 중단되었습니다. 이후 다시 수집하려면 채널 본인 확인 또는 재등록이 필요할 수 있습니다.
          </p>
        </div>
      )}

      {/* 액션 버튼 영역 */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-border/50">
        {/* 본인 확인 버튼 (미인증 상태일 때) */}
        {!isVerified && !isBlocked && !isManualOnly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => onVerify(source)}
            className="h-8 text-xs font-bold gap-1.5"
          >
            <CheckCircle2 className="size-3.5 text-primary" />
            <span>본인 채널 확인</span>
          </Button>
        )}

        {/* 수집 시작 버튼 (인증 완료되었고 차단/수집중/수기등록이 아닐 때) */}
        {isVerified && !isCollecting && !isBlocked && !isManualOnly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => onCollect(source)}
            className="h-8 text-xs font-bold gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            <span>내용 수집 시작</span>
          </Button>
        )}

        {/* 수집 중단 버튼 (수집 진행 중일 때) */}
        {isCollecting && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => onCancel(source)}
            className="h-8 text-xs font-bold text-destructive hover:bg-destructive/10 gap-1.5"
          >
            <XCircle className="size-3.5" />
            <span>수집 중단</span>
          </Button>
        )}

        {/* 지식 검토하기 버튼 (후보 지식이 있을 때) */}
        {hasReviewCandidates && (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={() => onReview(source)}
            className="h-8 text-xs font-bold gap-1.5 bg-primary text-primary-foreground shadow-xs"
          >
            <Clock className="size-3.5" />
            <span>지식 검토하기</span>
          </Button>
        )}

        {/* 출처 삭제 버튼 */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canManage}
          onClick={() => onDelete(source)}
          className="h-8 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
          aria-label="출처 삭제"
        >
          <Trash2 className="size-3.5" />
          <span>출처 삭제</span>
        </Button>
      </div>
    </Card>
  )
}
