'use client'

import React from 'react'
import { AlertTriangle, ShieldAlert, RefreshCw, ExternalLink, CheckCircle2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export type IntegrityAlertType =
  | 'FAIL_CLOSED'
  | 'SCHEMA_DRIFT'
  | 'ORPHAN_FOUND'
  | 'SCOPE_DRIFT'
  | 'NO_PROOF'
  | 'SECURITY_DEFINER_BLOCKED'

export interface IntegrityAlertProps {
  type: IntegrityAlertType
  title?: string
  description?: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  details?: Record<string, any>
}

/** 화면에 보이는 짧은 분류 라벨 (내부 코드는 화면에 노출하지 않는다) */
const ALERT_TYPE_LABELS: Record<IntegrityAlertType, string> = {
  FAIL_CLOSED: '안전 차단',
  SCHEMA_DRIFT: '구조 불일치',
  ORPHAN_FOUND: '연결 누락',
  SCOPE_DRIFT: '권한 범위 불일치',
  NO_PROOF: '확인 기록 없음',
  SECURITY_DEFINER_BLOCKED: '권한 차단',
}

const DEFAULT_ALERT_CONFIG: Record<
  IntegrityAlertType,
  { defaultTitle: string; defaultDesc: string; defaultAction: string; defaultHref: string; severity: 'error' | 'warning' | 'info' }
> = {
  FAIL_CLOSED: {
    defaultTitle: '영속화 전제 조건 실패로 외부 실행이 안전 차단되었습니다',
    defaultDesc: 'Supabase 원장 저장 또는 멱등키 획득에 실패하여 실제 SNS 외부 전송 및 과금 부과를 즉시 중단했습니다.',
    defaultAction: '원장 상태 확인',
    defaultHref: '/app/system',
    severity: 'error',
  },
  SCHEMA_DRIFT: {
    defaultTitle: '프로덕션 DB 스키마 불일치가 감지되었습니다',
    defaultDesc: '서버 런타임이 요구하는 테이블 또는 RPC 함수가 프로덕션 public 스키마와 일치하지 않습니다.',
    defaultAction: '시스템 진단 확인',
    defaultHref: '/app/system',
    severity: 'error',
  },
  ORPHAN_FOUND: {
    defaultTitle: '외부 게시 영수증과 매핑되지 않은 고아 검증 내역이 발견되었습니다',
    defaultDesc: '외부 채널에 게시물은 존재하나 canonical 원장에 영수증이 누락된 고아 항목이 존재합니다. 관리자 보정이 필요합니다.',
    defaultAction: '고아 보정 패널 열기',
    defaultHref: '/admin/channels',
    severity: 'warning',
  },
  SCOPE_DRIFT: {
    defaultTitle: 'Meta 채널 권한 범위 불일치가 감지되었습니다',
    defaultDesc: '실행하려는 기능(예: 댓글/DM 수신, 스레드 멘션)에 필요한 OAuth 스코프가 인가되지 않았습니다. 재연결이 필요합니다.',
    defaultAction: '채널 재인증하기',
    defaultHref: '/app/channels',
    severity: 'warning',
  },
  NO_PROOF: {
    defaultTitle: '실측 검증 영수증이 존재하지 않습니다',
    defaultDesc: '아직 실제 외부 플랫폼 API 성공 응답 및 Readback 검증 증거가 없습니다. 가짜 상태를 표시하지 않고 대기합니다.',
    defaultAction: '첫 미션 실행하기',
    defaultHref: '/app/content',
    severity: 'info',
  },
  SECURITY_DEFINER_BLOCKED: {
    defaultTitle: '권한 없는 RPC 직접 호출이 차단되었습니다',
    defaultDesc: '최소 권한 원칙에 따라 익명/인증되지 않은 역할의 위험한 DB 프로시저 실행이 폐쇄되었습니다.',
    defaultAction: '보안 정책 확인',
    defaultHref: '/admin/channels',
    severity: 'error',
  },
}

export function IntegrityAlert({
  type,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  details,
}: IntegrityAlertProps) {
  const config = DEFAULT_ALERT_CONFIG[type]
  const displayTitle = title || config.defaultTitle
  const displayDesc = description || config.defaultDesc
  const displayAction = actionLabel || config.defaultAction
  const displayHref = actionHref || config.defaultHref

  const isError = config.severity === 'error'
  const isWarning = config.severity === 'warning'

  const borderClass = isError
    ? 'border-state-danger/40 bg-state-danger/70 text-state-danger'
    : isWarning
    ? 'border-state-warn/40 bg-state-warn/70 text-state-warn'
    : 'border-state-wait/40 bg-state-wait/70 text-state-wait'

  const iconColor = isError ? 'text-state-danger' : isWarning ? 'text-state-warn' : 'text-state-wait'
  const badgeColor = isError
    ? 'bg-state-danger/80 text-state-danger'
    : isWarning
    ? 'bg-state-warn/80 text-state-warn'
    : 'bg-state-wait/80 text-state-wait'

  return (
    <div className={`p-4 rounded-2xl border shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-white/70 dark:bg-black/30`}>
          {isError ? (
            <ShieldAlert className={`w-4 h-4 ${iconColor}`} />
          ) : (
            <AlertTriangle className={`w-4 h-4 ${iconColor}`} />
          )}
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-black tracking-tight">{displayTitle}</h4>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${badgeColor}`}>
              {ALERT_TYPE_LABELS[type]}
            </span>
          </div>
          <p className="text-[11px] opacity-80 leading-relaxed font-medium">
            {displayDesc}
          </p>
        </div>
      </div>

      <div className="shrink-0 self-end sm:self-center">
        {onAction ? (
          <button
            onClick={onAction}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-current text-xs font-bold shadow-2xs hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
          >
            <span>{displayAction}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <Link
            href={displayHref}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-current text-xs font-bold shadow-2xs hover:opacity-80 transition-opacity flex items-center gap-1 cursor-pointer"
          >
            <span>{displayAction}</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  )
}
