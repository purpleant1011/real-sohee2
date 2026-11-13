'use client'

import { useState, type FormEvent } from 'react'
import type { BookingPassViewData } from '@/features/kakao/booking-pass/pass-view'
import { KakaoChannelCtaGroup } from '@/features/kakao/sdk/KakaoChannelCtaGroup'
import styles from './booking-pass.module.css'

type Props = Readonly<{
  initialPass: BookingPassViewData
  token: string
}>

function renderBadge(pass: BookingPassViewData) {
  const status = pass.status.toUpperCase()
  if (status === 'CONFIRMED') {
    return <span className={styles.badgeConfirmed}>{pass.statusLabel}</span>
  }
  if (status === 'CANCELLED') {
    return <span className={styles.badgeCancelled}>{pass.statusLabel}</span>
  }
  return <span className={styles.badgePending}>{pass.statusLabel}</span>
}

export default function BookingPassClientView({ initialPass, token }: Props) {
  const [pass, setPass] = useState<BookingPassViewData>(initialPass)
  const [last4, setLast4] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const channelPublicId =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID?.trim()
      : undefined
  const jsKey =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim()
      : undefined
  const hasKakaoChannelCta = Boolean(channelPublicId && jsKey)

  const isCancelled = pass.status.toUpperCase() === 'CANCELLED'

  async function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = last4.trim()
    if (!/^\d{4}$/u.test(trimmed)) {
      setErrorMsg('전화번호 뒤 4자리는 숫자 4자리로 입력해 주세요.')
      return
    }

    setBusy(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/public/booking-pass/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, last4: trimmed }),
      })
      const data = (await res.json()) as { ok: boolean; pass?: BookingPassViewData; error?: string }

      if (!res.ok || !data.ok || !data.pass) {
        setErrorMsg(data.error || '전화번호 뒤 4자리가 일치하지 않습니다.')
        return
      }

      setPass(data.pass)
    } catch {
      setErrorMsg('인증 처리 중 네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.ticketWrapper}>
      <article className={styles.ticketCard}>
        <header className={isCancelled ? styles.ticketHeaderCancelled : styles.ticketHeader}>
          <div className={styles.badgeRow}>
            {renderBadge(pass)}
            {pass.bookingNumber && (
              <span className={styles.bookingNumber}>#{pass.bookingNumber}</span>
            )}
          </div>
          <h1 className={styles.shopName}>{pass.shopName}</h1>
          {pass.serviceName ? (
            <p className={styles.serviceName}>{pass.serviceName}</p>
          ) : (
            <p className={styles.serviceName}>예약 확인</p>
          )}
        </header>

        <div className={styles.divider} aria-hidden="true">
          <div className={styles.dividerLeftCircle} />
          <div className={styles.dividerLine} />
          <div className={styles.dividerRightCircle} />
        </div>

        <section className={styles.ticketBody}>
          <div className={styles.infoGrid}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>예약 일시</span>
              <span className={styles.highlightValue}>{pass.startsAt}</span>
            </div>

            {pass.requiresReauth ? (
              <div className={styles.reauthBox}>
                <h2 className={styles.reauthTitle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  예약자 본인 확인
                </h2>
                <p className={styles.reauthDescription}>
                  예약 시 등록하신 휴대폰 번호 뒤 4자리를 입력하시면 상세 예약 내용과 결제 안내를 확인하실 수 있습니다.
                </p>
                <form className={styles.reauthForm} onSubmit={handleVerify}>
                  <div className={styles.inputGroup}>
                    <label htmlFor="last4-input" className={styles.inputLabel}>
                      전화번호 뒤 4자리
                    </label>
                    <input
                      id="last4-input"
                      type="tel"
                      inputMode="numeric"
                      pattern="\d{4}"
                      maxLength={4}
                      autoComplete="off"
                      placeholder="예: 5678"
                      value={last4}
                      onChange={(e) => setLast4(e.target.value)}
                      className={styles.reauthInput}
                      disabled={busy}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className={styles.reauthButton}
                    disabled={busy || last4.trim().length !== 4}
                  >
                    {busy ? '확인 중...' : '예약 상세 확인'}
                  </button>

                  {errorMsg && (
                    <div className={styles.reauthError} role="alert">
                      {errorMsg}
                    </div>
                  )}
                </form>
              </div>
            ) : (
              <>
                {pass.address && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>매장 위치</span>
                    <span className={styles.infoValue}>{pass.address}</span>
                  </div>
                )}

                {(pass.customerNameMasked || pass.customerPhoneMasked) && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>예약자</span>
                    <span className={styles.infoValue}>
                      {pass.customerNameMasked && <span>{pass.customerNameMasked}</span>}
                      {pass.customerPhoneMasked && (
                        <>
                          {' '}
                          <span>{pass.customerPhoneMasked}</span>
                        </>
                      )}
                    </span>
                  </div>
                )}

                {pass.paymentSummary && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>결제 안내</span>
                    <span className={styles.infoValue}>{pass.paymentSummary}</span>
                  </div>
                )}

                {pass.cancelReason && (
                  <div className={styles.cancelNotice}>
                    <strong>취소 사유:</strong> {pass.cancelReason}
                  </div>
                )}
              </>
            )}
          </div>

          {!pass.requiresReauth && (
            <div className={styles.actions}>
              {pass.naverMapUrl && (
                <a
                  href={pass.naverMapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.naverMapButton}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                    <line x1="9" y1="3" x2="9" y2="18" />
                    <line x1="15" y1="6" x2="15" y2="21" />
                  </svg>
                  네이버 지도 길찾기
                </a>
              )}

              {hasKakaoChannelCta && channelPublicId && jsKey && (
                <KakaoChannelCtaGroup
                  channelPublicId={channelPublicId}
                  jsKey={jsKey}
                />
              )}
            </div>
          )}
        </section>
      </article>
    </div>
  )
}
