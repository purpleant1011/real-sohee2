'use client'

import React, { useState } from 'react'
import { CalendarCheck, X, User, Phone, Clock, Sparkles, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { normalize010Phone } from '@/features/kakao/notify/outbox-processor'

export interface ReservationFormData {
  customerName: string
  customerPhone: string
  serviceName: string
  bookingStartsAt: string
  totalAmountKrw: number
  depositKrw: number
  notifyConsentAttested: boolean
}

export interface ReservationDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (data: ReservationFormData) => Promise<void> | void
  defaultCustomerName?: string
  defaultSuggestedTime?: string
  defaultServiceName?: string
  isSubmitting?: boolean
}

export function ReservationDialog({
  open,
  onClose,
  onConfirm,
  defaultCustomerName = '',
  defaultSuggestedTime = '',
  defaultServiceName = '1:1 맞춤 퍼스널 뷰티',
  isSubmitting = false,
}: Readonly<ReservationDialogProps>) {
  const [customerName, setCustomerName] = useState(defaultCustomerName)
  const [customerPhone, setCustomerPhone] = useState('')
  const [serviceName, setServiceName] = useState(defaultServiceName)
  const [bookingStartsAt, setBookingStartsAt] = useState(
    defaultSuggestedTime || '2026-10-20 14:00'
  )
  const [totalAmountKrw, setTotalAmountKrw] = useState(80000)
  const [depositKrw, setDepositKrw] = useState(20000)
  const [notifyConsentAttested, setNotifyConsentAttested] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copiedConfirmation, setCopiedConfirmation] = useState(false)

  const handleCopyConfirmation = async () => {
    const text = `[예약 확정 안내]
안녕하세요 ${customerName || '고객'}님! 예약이 정상적으로 확정되었습니다.

🌿 예약 일시: ${bookingStartsAt}
🌿 예약 서비스: ${serviceName}
${totalAmountKrw ? `🌿 시술 금액: ₩${totalAmountKrw.toLocaleString('ko-KR')}\n` : ''}${depositKrw ? `🌿 예약금: ₩${depositKrw.toLocaleString('ko-KR')} (확인 완료)\n` : ''}
방문 전 변동 사항이 있으시면 편하게 말씀해 주세요.
정성껏 준비하고 기다리겠습니다 😊`

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setCopiedConfirmation(true)
        toast.success('고객 전송용 확정 안내문이 복사되었어요! 카톡이나 DM에 붙여넣어 전송하세요 💌')
        setTimeout(() => setCopiedConfirmation(false), 2500)
      }
    } catch {
      toast.error('클립보드 복사에 실패했습니다.')
    }
  }

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) {
      setErrorMsg('고객명을 입력해 주세요.')
      return
    }
    const trimmedPhone = customerPhone.trim()
    if (trimmedPhone.length > 0) {
      const normalized = normalize010Phone(trimmedPhone)
      if (!normalized) {
        setErrorMsg('전화번호를 확인해 주세요.')
        return
      }
    }
    setErrorMsg(null)
    const attested = trimmedPhone.length > 0 ? notifyConsentAttested : false
    await onConfirm({
      customerName: customerName.trim(),
      customerPhone: trimmedPhone,
      serviceName: serviceName.trim(),
      bookingStartsAt,
      totalAmountKrw,
      depositKrw,
      notifyConsentAttested: attested,
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-card border border-border shadow-xl p-5 sm:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2 text-foreground dark:text-primary font-extrabold text-sm sm:text-base">
            <div className="size-8 rounded-xl bg-primary text-white flex items-center justify-center shadow-xs">
              <CalendarCheck className="size-4" />
            </div>
            <h3 id="reservation-dialog-title">예약 확정 등록</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        {errorMsg ? (
          <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs font-semibold">
            {errorMsg}
          </div>
        ) : null}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div className="space-y-1.5">
            <label htmlFor="customer-name-input" className="font-bold text-foreground flex items-center gap-1">
              <User className="size-3.5 text-muted-foreground" />
              <span>고객명 / SNS 핸들</span>
            </label>
            <input
              id="customer-name-input"
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              placeholder="예: 김민지 또는 @hoceol339"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="customer-phone-input" className="font-bold text-foreground flex items-center gap-1">
              <Phone className="size-3.5 text-muted-foreground" />
              <span>연락처 (선택)</span>
            </label>
            <input
              id="customer-phone-input"
              type="tel"
              value={customerPhone}
              onChange={(e) => {
                const sanitized = e.target.value.replace(/[^0-9-]/g, '')
                setCustomerPhone(sanitized)
                if (!sanitized.trim()) {
                  setNotifyConsentAttested(false)
                }
              }}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              placeholder="010-XXXX-XXXX"
            />
            <p className="text-[11px] text-muted-foreground">010으로 시작하는 휴대폰 번호</p>
          </div>

          {customerPhone.trim().length > 0 ? (
            <div className="rounded-xl border border-input bg-muted/30 p-3 space-y-1.5 transition-all">
              <label
                htmlFor="notify-consent-checkbox"
                className="flex items-start gap-2 cursor-pointer select-none font-bold text-foreground"
              >
                <input
                  id="notify-consent-checkbox"
                  type="checkbox"
                  checked={notifyConsentAttested}
                  onChange={(e) => setNotifyConsentAttested(e.target.checked)}
                  aria-describedby="notify-consent-description"
                  className="mt-0.5 size-4 rounded-md border border-input text-primary focus:ring-2 focus:ring-primary focus:outline-hidden cursor-pointer"
                />
                <span>고객에게 예약 안내 알림톡 발송 사실을 알렸습니다</span>
              </label>
              <p
                id="notify-consent-description"
                className="text-[11px] leading-relaxed text-muted-foreground pl-6"
              >
                사장님이 확인한 내용이 기록되며, 알리지 않은 고객에게는 체크하지 마세요.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="service-name-input" className="font-bold text-foreground flex items-center gap-1">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span>희망 시술 / 서비스명</span>
            </label>
            <input
              id="service-name-input"
              type="text"
              required
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              placeholder="예: 1:1 맞춤 속눈썹펌, 주말 디저트 코스, 원데이 클래스"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="booking-time-input" className="font-bold text-foreground flex items-center gap-1">
              <Clock className="size-3.5 text-muted-foreground" />
              <span>예약 일시</span>
            </label>
            <input
              id="booking-time-input"
              type="text"
              required
              value={bookingStartsAt}
              onChange={(e) => setBookingStartsAt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden font-mono"
              placeholder="예: 2026-10-20 14:00"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="total-amount-input" className="font-bold text-foreground">총 결제/시술 금액(원)</label>
              <input
                id="total-amount-input"
                type="number"
                value={totalAmountKrw}
                onChange={(e) => setTotalAmountKrw(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="deposit-amount-input" className="font-bold text-foreground">예약금(원)</label>
              <input
                id="deposit-amount-input"
                type="number"
                value={depositKrw}
                onChange={(e) => setDepositKrw(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs font-mono"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-between gap-2 border-t border-border/40 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyConfirmation}
              className="text-xs font-semibold border-primary/30 text-foreground dark:text-primary hover:bg-primary/10 dark:hover:bg-primary/50 cursor-pointer"
            >
              {copiedConfirmation ? (
                <>
                  <Check className="size-3.5 mr-1" />
                  안내문 복사됨!
                </>
              ) : (
                <>
                  <Copy className="size-3.5 mr-1" />
                  고객 확정 카톡/문자 복사
                </>
              )}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
                취소
              </Button>
              <Button type="submit" size="sm" className="bg-primary hover:bg-primary/90 text-white font-bold" disabled={isSubmitting}>
                {isSubmitting ? '등록 중...' : '확정 등록'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
