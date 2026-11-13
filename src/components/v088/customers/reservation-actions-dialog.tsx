'use client'

import React, { useState } from 'react'
import { X, AlertCircle, Calendar, MessageSquare, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ReservationActionsDialogProps {
  open: boolean
  mode: 'reschedule' | 'cancel' | 'decline'
  workspaceId: string
  reservationId: string
  customerName?: string
  customerPhone?: string
  hasKakaoHistory?: boolean
  currentBookingStartsAt?: string
  onClose: () => void
  onDone?: () => void | Promise<void>
}

function toDatetimeLocal(val?: string): string {
  if (!val) return ''
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    const year = d.getFullYear()
    const month = pad(d.getMonth() + 1)
    const day = pad(d.getDate())
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch {
    return ''
  }
}

export function ReservationActionsDialog({
  open,
  mode,
  workspaceId,
  reservationId,
  customerName,
  customerPhone,
  hasKakaoHistory = false,
  currentBookingStartsAt,
  onClose,
  onDone,
}: Readonly<ReservationActionsDialogProps>) {
  const [reason, setReason] = useState('')
  const [bookingStartsAt, setBookingStartsAt] = useState(() =>
    toDatetimeLocal(currentBookingStartsAt)
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!open) return null

  const hasPhone = Boolean(customerPhone && customerPhone.trim() !== '' && customerPhone.trim() !== '-')
  const showKakaoWillSend = Boolean(hasKakaoHistory || hasPhone)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMsg(null)

    if (mode === 'cancel' || mode === 'decline') {
      const trimmedReason = reason.trim()
      if (!trimmedReason) {
        setErrorMsg(mode === 'cancel' ? '취소 사유를 입력해 주세요.' : '거절 사유를 입력해 주세요.')
        return
      }

      setIsSubmitting(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/reservations/${reservationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: mode,
            reason: trimmedReason,
          }),
        })

        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setErrorMsg(
            data?.error ||
              (mode === 'cancel' ? '예약 취소 처리에 실패했습니다.' : '예약 거절 처리에 실패했습니다.')
          )
          return
        }

        if (onDone) {
          await onDone()
        }
        onClose()
      } catch {
        setErrorMsg('네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    } else {
      const trimmedStartsAt = bookingStartsAt.trim()
      if (!trimmedStartsAt) {
        setErrorMsg('변경할 예약 일시를 입력해 주세요.')
        return
      }

      setIsSubmitting(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/reservations/${reservationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reschedule',
            bookingStartsAt: trimmedStartsAt,
          }),
        })

        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setErrorMsg(data?.error || '예약 변경 처리에 실패했습니다.')
          return
        }

        if (onDone) {
          await onDone()
        }
        onClose()
      } catch {
        setErrorMsg('네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-xl space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            {mode === 'cancel' || mode === 'decline' ? (
              <div className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
            )}
            <div>
              <h3 id="dialog-title" className="text-base font-bold text-foreground">
                {mode === 'cancel' ? '예약 취소' : mode === 'decline' ? '예약 신청 거절' : '예약 변경'}
              </h3>
              {customerName && (
                <p className="text-xs text-muted-foreground">
                  고객: <span className="font-semibold text-foreground">{customerName}</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 안내 문구 */}
        <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 text-xs space-y-1.5">
          <div className="flex items-start gap-2 text-foreground font-medium">
            <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>
              {mode === 'decline'
                ? '예약 신청을 거절해요. 별도의 취소 안내 알림톡은 발송되지 않아요.'
                : mode === 'cancel'
                ? showKakaoWillSend
                  ? '취소하면 고객에게 취소 안내가 카카오톡으로 가요'
                  : '고객 연락처가 있으면 취소 안내가 카카오톡으로 갈 수 있어요'
                : '변경 안내가 카카오톡으로 갈 수 있어요'}
            </span>
          </div>
          {customerPhone && customerPhone !== '-' && (
            <p className="text-[11px] text-muted-foreground pl-6 font-mono">
              수신 번호: {customerPhone}
            </p>
          )}
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'cancel' || mode === 'decline' ? (
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="text-xs font-bold text-foreground">
                {mode === 'decline' ? '거절 사유' : '취소 사유'} <span className="text-destructive">*</span>
              </label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  mode === 'decline'
                    ? '거절 사유를 구체적으로 입력해 주세요 (예: 예약 가능 시간대 마감 등)'
                    : '취소 사유를 구체적으로 입력해 주세요 (예: 고객 개인 사정, 매장 휴무 등)'
                }
                className="w-full rounded-2xl border border-input bg-background p-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="reschedule-time" className="text-xs font-bold text-foreground">
                변경할 예약 일시 <span className="text-destructive">*</span>
              </label>
              <input
                id="reschedule-time"
                type="datetime-local"
                value={bookingStartsAt}
                onChange={(e) => setBookingStartsAt(e.target.value)}
                className="w-full rounded-2xl border border-input bg-background p-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs font-medium text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl text-xs font-bold"
            >
              닫기
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              variant={mode === 'cancel' || mode === 'decline' ? 'destructive' : 'default'}
              className="rounded-xl text-xs font-bold"
            >
              {isSubmitting
                ? '처리 중...'
                : mode === 'decline'
                ? '신청 거절'
                : mode === 'cancel'
                ? '예약 취소 확인'
                : '예약 변경 확인'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
