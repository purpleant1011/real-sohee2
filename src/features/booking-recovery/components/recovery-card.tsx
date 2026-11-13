'use client';

import React, { useState } from 'react';
import {
  type RecoveryView,
  type RecoveryCommand,
  recoveryStatusLabel,
} from '../contracts';

export interface RecoveryCardProps {
  view: RecoveryView;
  onCommand?: (command: RecoveryCommand) => Promise<void>;
  isLoading?: boolean;
  isReadOnly?: boolean;
}

export function RecoveryCard({
  view,
  onCommand,
  isLoading = false,
  isReadOnly = false,
}: RecoveryCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusText = view.statusLabel || recoveryStatusLabel(view.stage);

  // Format date helper using offer.timezone with Intl (Asia/Seoul fallback)
  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '-';
      const timeZone = view.offer?.timezone || 'Asia/Seoul';
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    } catch {
      return '-';
    }
  };

  const handleApproveSend = async () => {
    if (!onCommand || isSubmitting || !view.approval || view.approval.kind !== 'send') return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onCommand({
        kind: 'approve_send',
        expectedVersion: view.version,
        fingerprint: view.approval.fingerprint,
      });
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('409') || err?.code === 'VERSION_CONFLICT') {
        setErrorMessage('내용이 바뀌었어요. 최신 정보를 다시 확인해 주세요.');
      } else {
        setErrorMessage(err?.message || '답변 전송 승인에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveBooking = async () => {
    if (!onCommand || isSubmitting || !view.approval || view.approval.kind !== 'booking') return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onCommand({
        kind: 'approve_booking',
        expectedVersion: view.version,
        fingerprint: view.approval.fingerprint,
      });
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('409') || err?.code === 'VERSION_CONFLICT') {
        setErrorMessage('내용이 바뀌었어요. 최신 정보를 다시 확인해 주세요.');
      } else {
        setErrorMessage(err?.message || '예약 확정 승인에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReattestSchedule = async () => {
    if (!onCommand || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onCommand({
        kind: 'reattest_schedule',
        expectedVersion: view.version,
        slotId: view.offer?.slotId,
      });
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes('409') || err?.code === 'VERSION_CONFLICT') {
        setErrorMessage('내용이 바뀌었어요. 최신 정보를 다시 확인해 주세요.');
      } else {
        setErrorMessage(err?.message || '장부 재확인 처리에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status badge style
  const getBadgeClass = () => {
    switch (view.stage) {
      case 'BOOKING_CONFIRMED':
        return 'bg-state-ok-soft text-state-ok border-[var(--state-ok-line)]';
      case 'CUSTOMER_ACCEPTED':
      case 'AWAITING_BOOKING_APPROVAL':
        return 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]';
      case 'DRAFT_READY':
      case 'AWAITING_SEND_APPROVAL':
        return 'bg-state-warn-soft text-state-warn border-[var(--state-warn-line)]';
      case 'RESULT_UNKNOWN':
      case 'HUMAN_REVIEW':
        return 'bg-state-danger-soft text-state-danger border-[var(--state-danger-line)]';
      default:
        return 'bg-state-quiet-soft text-state-quiet border-[var(--state-quiet-line)]';
    }
  };

  return (
    <div
      className="w-full max-w-full rounded-2xl border border-border bg-card p-5 shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring"
      role="region"
      aria-label="예약 문의 회수 카드"
    >
      {/* 1. Header with Korean status */}
      <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-foreground">
            예약 문의 관리
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getBadgeClass()}`}
          >
            {statusText}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          확인 시각: {formatDateTime(view.observedAt)}
        </span>
      </div>

      {/* 2. Offer Details */}
      {view.offer ? (
        <div className="space-y-2 mb-4 rounded-xl bg-muted/50 p-3.5 text-sm text-foreground">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">신청 서비스</span>
            <span className="font-semibold text-foreground">
              {view.offer.serviceName}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">시술 금액</span>
            <span className="font-semibold text-foreground">
              {view.offer.totalAmountKrw.toLocaleString()}원
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">예약금</span>
            <span className="font-semibold text-foreground">
              {view.offer.depositKrw.toLocaleString()}원
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">예약 가능 시간</span>
            <span className="font-semibold text-foreground">
              {formatDateTime(view.offer.startsAt)}
            </span>
          </div>
          {view.offer.validUntil && (
            <div className="flex justify-between items-center text-xs text-muted-foreground pt-1 border-t border-border/60">
              <span>슬롯 유효 기한</span>
              <span>{formatDateTime(view.offer.validUntil)}까지</span>
            </div>
          )}
        </div>
      ) : null}

      {/* 3. Reply draft text */}
      {view.reply?.text ? (
        <div className="mb-4">
          <span className="block text-xs font-semibold text-muted-foreground mb-1">
            고객 안내 문안
          </span>
          <div className="rounded-xl border border-border bg-background p-3 text-sm text-foreground whitespace-pre-wrap">
            {view.reply.text}
          </div>
        </div>
      ) : null}

      {/* 4. Acceptance evidence note */}
      {view.acceptance ? (
        <div className="mb-4 rounded-xl bg-state-ok-soft border border-[var(--state-ok-line)] p-3 text-xs text-state-ok">
          <p className="font-semibold mb-0.5">고객 예약 수락 확인됨</p>
          <p>수신 일시: {formatDateTime(view.acceptance.receivedAt)}</p>
        </div>
      ) : null}

      {/* 5. Confirmed reservation reference */}
      {view.booking ? (
        <div
          className={`mb-4 rounded-xl border p-3 text-sm ${
            view.booking.status === 'CANCELLED'
              ? 'bg-state-quiet-soft border-[var(--state-quiet-line)] text-state-quiet'
              : 'bg-state-ok-soft border-[var(--state-ok-line)] text-state-ok'
          }`}
        >
          <p className="font-bold">
            {view.booking.status === 'CANCELLED' ? '예약 취소됨' : '예약 장부 등록 완료'}
          </p>
          <p className="text-xs mt-0.5">
            확정 일시: {formatDateTime(view.booking.confirmedAt)}
          </p>
        </div>
      ) : null}

      {/* 6. Human Review / Unknown Notice */}
      {view.stage === 'RESULT_UNKNOWN' || view.stage === 'HUMAN_REVIEW' ? (
        <div className="mb-4 rounded-xl bg-state-danger-soft border border-[var(--state-danger-line)] p-3 text-xs text-state-danger">
          <p className="font-semibold mb-0.5">채널 확인이 필요합니다</p>
          <p>외부 메시지 발송 결과를 자동으로 확인할 수 없어 사장님의 직접 확인이 필요해요.</p>
        </div>
      ) : null}

      {/* 7. Error message notification */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-4 rounded-xl bg-state-danger-soft border border-[var(--state-danger-line)] p-3 text-xs font-semibold text-state-danger"
        >
          {errorMessage}
        </div>
      )}

      {/* 8. Action Buttons */}
      {!isReadOnly && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          {view.nextAction === 'reattest_schedule' ? (
            <button
              type="button"
              disabled={isSubmitting || isLoading}
              onClick={handleReattestSchedule}
              className="inline-flex items-center justify-center rounded-xl bg-primary hover:bg-primary/90 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {isSubmitting ? '장부 재확인 중...' : '장부 재확인하기'}
            </button>
          ) : view.nextAction === 'approve_send' && view.approval?.kind === 'send' ? (
            <button
              type="button"
              disabled={isSubmitting || isLoading}
              onClick={handleApproveSend}
              className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background shadow-sm hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {isSubmitting ? '전송 승인 처리 중...' : '답변 전송 승인'}
            </button>
          ) : view.nextAction === 'approve_booking' && view.approval?.kind === 'booking' ? (
            <button
              type="button"
              disabled={isSubmitting || isLoading}
              onClick={handleApproveBooking}
              className="inline-flex items-center justify-center rounded-xl bg-primary hover:bg-primary/90 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {isSubmitting ? '예약 확정 처리 중...' : '예약 확정 승인'}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
