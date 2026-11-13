'use client'

import { useState } from 'react'
import styles from './booking-request.module.css'

interface BookingRequestClientFormProps {
  token: string
  storeName: string
}

export default function BookingRequestClientForm({
  token,
  storeName,
}: BookingRequestClientFormProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [desiredStartsAt, setDesiredStartsAt] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    const trimmedName = customerName.trim()
    if (!trimmedName) {
      setErrorMessage('이름을 입력해 주세요.')
      return
    }

    const trimmedPhone = customerPhone.trim()
    if (!trimmedPhone) {
      setErrorMessage('휴대폰 번호를 입력해 주세요.')
      return
    }

    if (!desiredStartsAt) {
      setErrorMessage('희망 일시를 선택해 주세요.')
      return
    }

    if (!consent) {
      setErrorMessage('개인정보 수집 및 이용에 동의해 주세요.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/public/booking-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          customerName: trimmedName,
          customerPhone: trimmedPhone,
          desiredStartsAt,
          consent,
          website: website.trim(),
        }),
      })

      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setIsSuccess(true)
      } else {
        setErrorMessage(data?.error || '예약 신청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
      }
    } catch {
      setErrorMessage('네트워크 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className={styles.successCard}>
        <div className={styles.successIcon} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className={styles.successTitle}>신청이 접수됐어요.</h1>
        <p className={styles.successSubtitle}>
          매장에서 확인하면 카카오톡으로 안내드려요.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <header className={styles.header}>
        <span className={styles.badge}>예약 신청</span>
        <h1 className={styles.storeName}>{storeName}</h1>
        <p className={styles.headerSubtitle}>
          희망하시는 일시와 연락처를 남겨주시면 매장에서 확인 후 안내드려요.
        </p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {/* Honeypot field */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        <div className={styles.field}>
          <label htmlFor="customerName" className={styles.label}>
            이름 <span className={styles.requiredMark}>*</span>
          </label>
          <input
            id="customerName"
            type="text"
            className={styles.input}
            placeholder="성함을 입력해 주세요"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={50}
            autoComplete="name"
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="customerPhone" className={styles.label}>
            휴대폰 번호 <span className={styles.requiredMark}>*</span>
          </label>
          <input
            id="customerPhone"
            type="tel"
            inputMode="numeric"
            className={styles.input}
            placeholder="010-1234-5678"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            autoComplete="tel"
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="desiredStartsAt" className={styles.label}>
            희망 일시 <span className={styles.requiredMark}>*</span>
          </label>
          <input
            id="desiredStartsAt"
            type="datetime-local"
            className={styles.input}
            value={desiredStartsAt}
            onChange={(e) => setDesiredStartsAt(e.target.value)}
            required
          />
        </div>

        <div className={styles.consentContainer}>
          <label className={styles.consentLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span className={styles.consentText}>
              예약 확인과 변경·취소 안내를 카카오톡으로 받기 위해 이름과 휴대폰 번호를 수집하며, 예약 안내 목적 외에는 사용하지 않아요. 요청하시면 삭제해 드려요.
            </span>
          </label>
        </div>

        {errorMessage && (
          <div className={styles.errorBanner} role="alert">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting}
        >
          {isSubmitting ? '신청 접수 중...' : '예약 신청하기'}
        </button>
      </form>
    </div>
  )
}
