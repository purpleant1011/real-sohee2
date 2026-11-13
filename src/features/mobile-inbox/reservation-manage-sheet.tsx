'use client'

import React, { useState } from 'react'
import { CalendarClock, CalendarX2, AlertCircle, Clock, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { MobileSheet } from '@/components/mobile-ui/mobile-sheet'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export interface ManageReservationTarget {
  id: string
  customerName: string
  serviceLabel: string
  startsAt: string
  endsAt?: string
  status?: string
}

export interface MobileReservationManageSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  reservation: ManageReservationTarget | null
  onDone?: () => void
}

function toDateTimeLocalKst(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const kstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    return kstDate.toISOString().slice(0, 16)
  } catch {
    return ''
  }
}

function formatCurrentTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

interface ReservationManageContentProps {
  workspaceId: string
  reservation: ManageReservationTarget
  onClose: () => void
  onDone?: () => void
}

function ReservationManageContent({
  workspaceId,
  reservation,
  onClose,
  onDone,
}: Readonly<ReservationManageContentProps>) {
  const isAwaiting =
    reservation.status === 'pending_confirmation' ||
    reservation.status === 'AWAITING_CONFIRMATION'

  const [mode, setMode] = useState<'reschedule' | 'cancel' | 'confirm' | 'decline'>(() =>
    isAwaiting ? 'confirm' : 'reschedule'
  )
  const [bookingStartsAt, setBookingStartsAt] = useState(() =>
    toDateTimeLocalKst(reservation.startsAt)
  )
  const [cancelReason, setCancelReason] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isPreview = workspaceId.startsWith('preview-')

  const handleTabChange = (nextMode: 'reschedule' | 'cancel' | 'confirm' | 'decline') => {
    setMode(nextMode)
    setErrorMsg(null)
    setConfirmingCancel(false)
  }

  const handleConfirmSubmit = async () => {
    if (isPreview) return
    setErrorMsg(null)
    setIsSubmitting(true)

    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/reservations/${encodeURIComponent(reservation.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm' }),
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error || '예약 신청을 확정하지 못했습니다.')
        return
      }

      toast.success('예약 신청을 확정했어요.')
      onClose()
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '예약 신청을 확정하지 못했습니다.'
      setErrorMsg(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeclineSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPreview) return

    const trimmed = declineReason.trim()
    if (!trimmed) {
      setErrorMsg('거절 사유를 입력해 주세요.')
      return
    }
    if (trimmed.length > 200) {
      setErrorMsg('거절 사유는 200자 이내로 입력해 주세요.')
      return
    }

    setErrorMsg(null)
    setIsSubmitting(true)

    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/reservations/${encodeURIComponent(reservation.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'decline',
            reason: trimmed,
          }),
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error || '예약 신청을 거절하지 못했습니다.')
        return
      }

      toast.success('예약 신청을 거절했어요.')
      onClose()
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '예약 신청을 거절하지 못했습니다.'
      setErrorMsg(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPreview) return

    if (!bookingStartsAt.trim()) {
      setErrorMsg('변경할 예약 일시를 입력해 주세요.')
      return
    }

    setErrorMsg(null)
    setIsSubmitting(true)

    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/reservations/${encodeURIComponent(reservation.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reschedule',
            bookingStartsAt: bookingStartsAt.trim(),
          }),
        }
      )

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErrorMsg(json.error || '예약 일정을 변경하지 못했습니다.')
        return
      }

      toast.success('예약 일정을 변경했어요.')
      onClose()
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '예약 일정을 변경하지 못했습니다.'
      setErrorMsg(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelClick = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPreview) return

    const trimmed = cancelReason.trim()
    if (!trimmed) {
      setErrorMsg('취소 사유를 입력해 주세요.')
      return
    }
    if (trimmed.length > 200) {
      setErrorMsg('취소 사유는 200자 이내로 입력해 주세요.')
      return
    }

    setErrorMsg(null)
    setConfirmingCancel(true)
  }

  const handleConfirmCancel = async () => {
    if (isPreview) return

    setErrorMsg(null)
    setIsSubmitting(true)

    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/reservations/${encodeURIComponent(reservation.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel',
            reason: cancelReason.trim(),
          }),
        }
      )

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErrorMsg(json.error || '예약을 취소하지 못했습니다.')
        return
      }

      if (json.status === 'already') {
        toast.info('이미 취소된 예약입니다.')
      } else {
        toast.success('예약이 취소되었습니다.')
      }

      onClose()
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '예약을 취소하지 못했습니다.'
      setErrorMsg(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 pt-2 text-sm text-foreground">
      {/* 요약 카드 */}
      <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Sparkles className="size-4 text-primary shrink-0" />
          <span>
            {reservation.customerName} · {reservation.serviceLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          <span>현재 일시: {formatCurrentTime(reservation.startsAt)}</span>
        </div>
      </div>

      {/* 탭 버튼 */}
      {isAwaiting ? (
        <div
          role="tablist"
          aria-label="예약 신청 관리 모드"
          className="flex rounded-xl bg-muted p-1 gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'confirm'}
            onClick={() => handleTabChange('confirm')}
            className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'confirm'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CheckCircle2 className="size-4 text-state-ok" />
            <span>신청 확정</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'decline'}
            onClick={() => handleTabChange('decline')}
            className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'decline'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <XCircle className="size-4 text-destructive" />
            <span>신청 거절</span>
          </button>
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="예약 관리 모드"
          className="flex rounded-xl bg-muted p-1 gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'reschedule'}
            onClick={() => handleTabChange('reschedule')}
            className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'reschedule'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarClock className="size-4" />
            <span>일정 변경</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'cancel'}
            onClick={() => handleTabChange('cancel')}
            className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'cancel'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarX2 className="size-4" />
            <span>예약 취소</span>
          </button>
        </div>
      )}

      {isPreview ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground"
        >
          <AlertCircle className="size-4 shrink-0 text-muted-foreground mt-0.5" />
          <span>
            예시 화면에서는 예약을 변경하거나 취소할 수 없어요. 실제 화면에서 이용해 주세요.
          </span>
        </div>
      ) : null}

      {errorMsg ? (
        <div
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive leading-relaxed"
        >
          {errorMsg}
        </div>
      ) : null}

      {/* 일정 변경 모드 */}
      {mode === 'reschedule' ? (
        <form onSubmit={handleRescheduleSubmit} noValidate className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
            변경 안내가 카카오톡으로 갈 수 있어요
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="manage-booking-starts-at"
              className="flex items-center gap-1.5 font-bold"
            >
              <CalendarClock className="size-4 text-muted-foreground" />
              <span>변경할 예약 일시</span>
            </label>
            <input
              id="manage-booking-starts-at"
              type="datetime-local"
              value={bookingStartsAt}
              onChange={(e) => setBookingStartsAt(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base font-mono focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              날짜와 시간을 골라 주세요 (한국 시간 기준이에요)
            </p>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={isPreview || isSubmitting}
              className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-xs transition-colors hover:bg-primary/90"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <CalendarClock className="size-4 animate-spin" />
                  <span>변경 중...</span>
                </span>
              ) : (
                '일정 변경'
              )}
            </Button>
          </div>
        </form>
      ) : null}

      {/* 예약 취소 모드 */}
      {mode === 'cancel' ? (
        <div className="space-y-4">
          {confirmingCancel ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive leading-relaxed space-y-1.5"
              >
                <p className="font-bold">
                  정말 취소할까요? 고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요
                </p>
                <p className="text-xs text-destructive/80">취소 사유: {cancelReason}</p>
              </div>

              <div className="space-y-2 pt-1">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleConfirmCancel}
                  disabled={isPreview || isSubmitting}
                  className="w-full min-h-11 rounded-xl font-semibold text-sm"
                >
                  {isSubmitting ? '취소 처리 중...' : '네, 취소할게요'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={isSubmitting}
                  className="w-full min-h-11 rounded-xl font-semibold text-sm"
                >
                  돌아가기
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCancelClick} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="manage-cancel-reason"
                  className="flex items-center gap-1.5 font-bold"
                >
                  <CalendarX2 className="size-4 text-muted-foreground" />
                  <span>취소 사유 (필수)</span>
                </label>
                <textarea
                  id="manage-cancel-reason"
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="고객 요청, 매장 사정 등 취소 사유를 적어 주세요."
                  maxLength={200}
                  className="w-full rounded-xl border border-input bg-background p-3 text-base focus:outline-hidden focus:ring-2 focus:ring-primary leading-relaxed resize-none"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1~200자 이내로 입력해 주세요</span>
                  <span>{cancelReason.length}/200자</span>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPreview || isSubmitting}
                  className="w-full min-h-11 rounded-xl font-semibold text-sm shadow-xs"
                >
                  예약 취소
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      {/* 신청 확정 모드 */}
      {mode === 'confirm' ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
            예약 신청을 확정하면 고객에게 예약 확정 카카오톡 안내가 발송돼요.
          </div>
          <div className="pt-2">
            <Button
              type="button"
              onClick={handleConfirmSubmit}
              disabled={isPreview || isSubmitting}
              className="w-full min-h-11 rounded-xl bg-state-ok hover:bg-state-ok/90 text-state-ok-soft font-semibold text-sm shadow-xs transition-colors"
            >
              {isSubmitting ? '확정 처리 중...' : '예약 신청 확정'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 신청 거절 모드 */}
      {mode === 'decline' ? (
        <form onSubmit={handleDeclineSubmit} noValidate className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
            예약 신청을 거절해요. 별도의 취소 안내 알림톡은 발송되지 않아요.
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="manage-decline-reason"
              className="flex items-center gap-1.5 font-bold"
            >
              <XCircle className="size-4 text-destructive" />
              <span>거절 사유 (필수)</span>
            </label>
            <textarea
              id="manage-decline-reason"
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="예약 가능 시간대 마감 등 거절 사유를 적어 주세요."
              maxLength={200}
              className="w-full rounded-xl border border-input bg-background p-3 text-base focus:outline-hidden focus:ring-2 focus:ring-primary leading-relaxed resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1~200자 이내로 입력해 주세요</span>
              <span>{declineReason.length}/200자</span>
            </div>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={isPreview || isSubmitting}
              className="w-full min-h-11 rounded-xl font-semibold text-sm shadow-xs"
            >
              {isSubmitting ? '거절 처리 중...' : '예약 신청 거절'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

export function MobileReservationManageSheet({
  open,
  onOpenChange,
  workspaceId,
  reservation,
  onDone,
}: Readonly<MobileReservationManageSheetProps>) {
  if (!reservation) return null

  const isAwaiting =
    reservation.status === 'pending_confirmation' ||
    reservation.status === 'AWAITING_CONFIRMATION'

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isAwaiting ? '예약 신청 관리' : '예약 관리'}
      description={
        isAwaiting
          ? '고객이 신청한 예약을 확정하거나 거절해요.'
          : '예약 일정을 변경하거나 취소해요.'
      }
    >
      <ReservationManageContent
        key={reservation.id}
        workspaceId={workspaceId}
        reservation={reservation}
        onClose={() => onOpenChange(false)}
        onDone={onDone}
      />
    </MobileSheet>
  )
}
