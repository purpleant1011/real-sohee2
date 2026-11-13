'use client'

import React, { useState } from 'react'
import { CalendarCheck, User, Phone, Sparkles, Clock, AlertCircle } from 'lucide-react'
import { MobileSheet } from '@/components/mobile-ui/mobile-sheet'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { normalize010Phone } from '@/features/kakao/notify/outbox-processor'

export interface MobileReservationSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  defaultCustomerName?: string
  defaultSuggestedTime?: string
  defaultServiceName?: string
  onSuccess?: () => void
}

export function MobileReservationSheet({
  open,
  onOpenChange,
  workspaceId,
  defaultCustomerName = '',
  defaultSuggestedTime = '',
  defaultServiceName = '1:1 맞춤 퍼스널 뷰티',
  onSuccess,
}: Readonly<MobileReservationSheetProps>) {
  const [customerName, setCustomerName] = useState(defaultCustomerName)
  const [customerPhone, setCustomerPhone] = useState('')
  const [serviceName, setServiceName] = useState(defaultServiceName)
  const [bookingStartsAt, setBookingStartsAt] = useState(
    defaultSuggestedTime || ''
  )
  const [totalAmountKrw, setTotalAmountKrw] = useState(80000)
  const [depositKrw, setDepositKrw] = useState(20000)
  const [notifyConsentAttested, setNotifyConsentAttested] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isPreview = workspaceId.startsWith('preview-')
  const trimmedPhone = customerPhone.trim()
  const hasPhone = trimmedPhone.length > 0

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value.replace(/[^0-9-]/g, '')
    setCustomerPhone(sanitized)
    if (!sanitized.trim()) {
      setNotifyConsentAttested(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPreview) return

    if (!customerName.trim()) {
      setErrorMsg('고객명을 입력해 주세요.')
      return
    }

    if (hasPhone) {
      const normalized = normalize010Phone(trimmedPhone)
      if (!normalized) {
        setErrorMsg('전화번호를 확인해 주세요.')
        return
      }
    }

    if (!serviceName.trim()) {
      setErrorMsg('서비스명을 입력해 주세요.')
      return
    }

    if (!bookingStartsAt.trim()) {
      setErrorMsg('예약 일시를 입력해 주세요.')
      return
    }

    setErrorMsg(null)
    setIsSubmitting(true)

    const attested = hasPhone ? notifyConsentAttested : false

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: trimmedPhone || undefined,
          serviceName: serviceName.trim(),
          bookingStartsAt: bookingStartsAt.trim(),
          totalAmountKrw,
          depositKrw,
          notifyConsentAttested: attested,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErrorMsg(json.error || '예약을 등록하지 못했습니다.')
        return
      }

      if (json.consentEvidenceRecorded === false && attested) {
        toast.warning('예약은 저장됐지만 안내 확인 기록은 저장하지 못했어요')
      } else {
        toast.success('예약이 등록되었습니다.')
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      setErrorMsg(err?.message || '예약을 등록하지 못했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="예약 등록"
      description="새 예약을 장부에 등록해요."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-sm text-foreground">
        {isPreview ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground"
          >
            <AlertCircle className="size-4 shrink-0 text-muted-foreground mt-0.5" />
            <span>예시 화면에서는 예약을 등록할 수 없어요. 실제 화면에서 이용해 주세요.</span>
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

        <div className="space-y-1.5">
          <label htmlFor="mobile-res-customer-name" className="flex items-center gap-1.5 font-bold">
            <User className="size-4 text-muted-foreground" />
            <span>고객 이름</span>
          </label>
          <input
            id="mobile-res-customer-name"
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="예: 김민지 또는 @hoceol339"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base focus:outline-hidden focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mobile-res-customer-phone" className="flex items-center gap-1.5 font-bold">
            <Phone className="size-4 text-muted-foreground" />
            <span>휴대폰 번호 (선택)</span>
          </label>
          <input
            id="mobile-res-customer-phone"
            type="tel"
            value={customerPhone}
            onChange={handlePhoneChange}
            placeholder="010-XXXX-XXXX"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base font-mono focus:outline-hidden focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">010으로 시작하는 휴대폰 번호</p>
        </div>

        {hasPhone ? (
          <div className="rounded-xl border border-input bg-muted/30 p-3 space-y-1.5 transition-all">
            <label
              htmlFor="mobile-res-notify-consent"
              className="flex items-start gap-2.5 cursor-pointer select-none font-semibold text-foreground text-xs leading-5"
            >
              <input
                id="mobile-res-notify-consent"
                type="checkbox"
                checked={notifyConsentAttested}
                onChange={(e) => setNotifyConsentAttested(e.target.checked)}
                aria-describedby="mobile-res-notify-description"
                className="mt-0.5 size-4 rounded-md border border-input text-primary focus:ring-2 focus:ring-primary cursor-pointer"
              />
              <span>고객에게 예약 안내 알림톡 발송 사실을 알렸습니다</span>
            </label>
            <p
              id="mobile-res-notify-description"
              className="pl-6 text-[11px] leading-relaxed text-muted-foreground"
            >
              사장님이 확인한 내용이 기록되며, 알리지 않은 고객에게는 체크하지 마세요.
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="mobile-res-service-name" className="flex items-center gap-1.5 font-bold">
            <Sparkles className="size-4 text-muted-foreground" />
            <span>서비스명</span>
          </label>
          <input
            id="mobile-res-service-name"
            type="text"
            required
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="예: 1:1 맞춤 속눈썹펌, 주말 디저트 코스"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base focus:outline-hidden focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mobile-res-booking-time" className="flex items-center gap-1.5 font-bold">
            <Clock className="size-4 text-muted-foreground" />
            <span>예약 일시</span>
          </label>
          <input
            id="mobile-res-booking-time"
            type="datetime-local"
            required
            value={bookingStartsAt}
            onChange={(e) => setBookingStartsAt(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base font-mono focus:outline-hidden focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">날짜와 시간을 골라 주세요 (한국 시간 기준이에요)</p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="space-y-1.5">
            <label htmlFor="mobile-res-total-amount" className="font-bold text-xs">
              총 금액 (원)
            </label>
            <input
              id="mobile-res-total-amount"
              type="number"
              value={totalAmountKrw}
              onChange={(e) => setTotalAmountKrw(Number(e.target.value))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mobile-res-deposit" className="font-bold text-xs">
              예약금 (원)
            </label>
            <input
              id="mobile-res-deposit"
              type="number"
              value={depositKrw}
              onChange={(e) => setDepositKrw(Number(e.target.value))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base font-mono"
            />
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            disabled={isPreview || isSubmitting}
            className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-xs transition-colors hover:bg-primary/90"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <CalendarCheck className="size-4 animate-spin" />
                <span>등록 중...</span>
              </span>
            ) : (
              '예약 등록'
            )}
          </Button>
        </div>
      </form>
    </MobileSheet>
  )
}
