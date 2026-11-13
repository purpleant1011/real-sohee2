'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  subscriptionOffers,
  subscriptionOfferPolicy,
} from './subscription-offers'
import styles from '@/features/marketing/marketing.module.css'

export const REVIEW_STORE_ID = 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63'
export const REVIEW_CHANNEL_KEY = 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^[0-9\-+]{9,15}$/

export function PgReviewCheckout() {
  const [selectedPlanCode, setSelectedPlanCode] = useState<string>(
    subscriptionOffers[0].code,
  )
  const [workspaceId, setWorkspaceId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')

  const [consentTerms, setConsentTerms] = useState(false)
  const [consentPrivacy, setConsentPrivacy] = useState(false)
  const [consentBillingReview, setConsentBillingReview] = useState(false)

  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [isServerVerified, setIsServerVerified] = useState(false)

  useEffect(() => {
    async function prefillUserContext() {
      try {
        const { createBrowserSupabaseClient } = await import('@/lib/supabase/client')
        const supabase = createBrowserSupabaseClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setEmail((prev) => prev || user.email || '')
          setFullName((prev) => prev || '심사담당자')
          setPhoneNumber((prev) => prev || '010-0000-0000')
          const { data: members } = await supabase
            .from('workspace_members')
            .select('workspace_id')
            .eq('user_id', user.id)
            .limit(1)
          if (members && members[0]?.workspace_id) {
            setWorkspaceId((prev) => prev || members[0].workspace_id)
          }
        }
      } catch {
        // safe fallback
      }
    }
    void prefillUserContext()
  }, [])

  const selectedPlan =
    subscriptionOffers.find((p) => p.code === selectedPlanCode) ??
    subscriptionOffers[0]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return

    setErrorMessage(null)
    setStatusNotice(null)
    setIsServerVerified(false)

    const trimmedWorkspaceId = workspaceId.trim()
    const trimmedName = fullName.trim()
    const trimmedEmail = email.trim()
    const trimmedPhone = phoneNumber.trim()

    if (
      !UUID_REGEX.test(trimmedWorkspaceId) ||
      trimmedName.length < 2 ||
      !EMAIL_REGEX.test(trimmedEmail) ||
      !PHONE_REGEX.test(trimmedPhone) ||
      !consentTerms ||
      !consentPrivacy ||
      !consentBillingReview
    ) {
      setErrorMessage(
        '모든 필수 항목을 입력하고 동의해 주세요. 워크스페이스 식별자 형식을 확인해 주세요.',
      )
      return
    }

    setIsPending(true)

    try {
      const res = await fetch('/api/payments/review/billing-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: trimmedWorkspaceId,
          planCode: selectedPlan.code,
          policyVersion: subscriptionOfferPolicy.version,
          customer: {
            fullName: trimmedName,
            email: trimmedEmail,
            phoneNumber: trimmedPhone,
          },
          consents: {
            terms: true,
            privacy: true,
            billingReview: true,
          },
        }),
      })

      if (!res.ok) {
        setErrorMessage(
          '요청 처리 중 오류가 발생했습니다. 입력 정보를 확인하고 다시 시도해 주세요.',
        )
        return
      }

      const data = await res.json()

      // Rigorous response validation before calling PortOne SDK
      const isValidMode = data?.mode === 'TEST'
      const req = data?.request
      const isValidStore = req?.storeId === REVIEW_STORE_ID
      const isValidChannel = req?.channelKey === REVIEW_CHANNEL_KEY
      const isValidMethod = req?.billingKeyMethod === 'CARD'
      const isValidAmount = req?.displayAmount === selectedPlan.monthlyTotalPriceKrw

      let isValidRedirect = false
      try {
        if (typeof req?.redirectUrl === 'string') {
          const parsedUrl = new URL(req.redirectUrl, window.location.origin)
          if (
            parsedUrl.origin === window.location.origin &&
            parsedUrl.pathname === '/pg-review/return'
          ) {
            isValidRedirect = true
          }
        }
      } catch {
        isValidRedirect = false
      }

      if (
        !isValidMode ||
        !isValidStore ||
        !isValidChannel ||
        !isValidMethod ||
        !isValidAmount ||
        !isValidRedirect
      ) {
        setErrorMessage(
          '보안 정책에 따라 테스트 연동 요청이 거부되었습니다.',
        )
        return
      }

      // Officially authorized SDK call: requestIssueBillingKey ONLY
      const { requestIssueBillingKey } = await import(
        '@portone/browser-sdk/v2'
      )
      const issueResponse = await requestIssueBillingKey(req)

      if (!issueResponse || issueResponse.code) {
        setStatusNotice(
          '빌링키 발급 창이 취소되었거나 닫혔습니다. 결제나 카드 등록은 진행되지 않았습니다.',
        )
        return
      }

      if (issueResponse.billingKey) {
        const billingKey = issueResponse.billingKey
        // Transmit billingKey to server verify endpoint once without persisting to DOM/storage/log
        const verifyRes = await fetch(
          '/api/payments/review/billing-key/verify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billingKey }),
          },
        )

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json()
          if (
            verifyData.status === 'verified_test_billing_key' &&
            verifyData.paymentCharged === false &&
            verifyData.subscriptionActivated === false
          ) {
            setIsServerVerified(true)
            setStatusNotice(
              '테스트 상점 및 채널 검증이 완료되었습니다. 실제 청구나 구독 활성화는 발생하지 않았습니다.',
            )
          } else {
            setStatusNotice(
              '서버 검증을 완료하지 못했습니다. 실제 청구나 구독 활성화는 진행되지 않았습니다.',
            )
          }
        } else {
          setStatusNotice(
            '서버 검증 처리 중 오류가 발생했습니다. 실제 청구나 구독 활성화는 진행되지 않았습니다.',
          )
        }
      } else {
        setStatusNotice(
          '결과를 확인하지 못했습니다. 결제나 카드 등록은 진행되지 않았습니다.',
        )
      }
    } catch {
      setErrorMessage(
        '요청 처리 중 오류가 발생했습니다. 입력 정보를 확인하고 다시 시도해 주세요.',
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <article className={styles.legalPage}>
      <header>
        <p className={styles.kicker}>PG 심사 전용</p>
        <h1>심사용 TEST 카드등록창 확인</h1>
        <p className={styles.legalLead}>
          본 화면은 PG사 심사 담당자의 연동 창 확인을 위한 테스트 전용 화면입니다.
        </p>
      </header>

      <section
        style={{
          padding: '1rem',
          backgroundColor: 'rgba(255, 230, 200, 0.2)',
          border: '1px solid #e09950',
          borderRadius: '8px',
          marginBlock: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 'bold', margin: 0, color: '#b25e00' }}>
          심사 안내 및 금지 행위 고지
        </h2>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li>
            <strong>실제 청구 및 구독 활성화는 진행되지 않습니다.</strong>
          </li>
          <li>
            <strong>최종 카드등록, 본인인증, 실출금 행위는 금지</strong>되어 있습니다.
          </li>
          <li>
            테스트 모드(KG이니시스 V2) 창 진입 및 규격 확인 용도로만 사용됩니다.
          </li>
        </ul>
      </section>

      {isServerVerified && (
        <div
          role="status"
          style={{
            padding: '1rem',
            backgroundColor: '#e6fffa',
            border: '1px solid #38b2ac',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            color: '#234e52',
          }}
        >
          <strong style={{ display: 'block', fontSize: '1.1rem' }}>
            TEST 등록 서버 확인(결제 아님)
          </strong>
          {statusNotice && <p style={{ margin: '0.25rem 0 0' }}>{statusNotice}</p>}
        </div>
      )}

      {!isServerVerified && statusNotice && (
        <div
          role="status"
          style={{
            padding: '1rem',
            backgroundColor: '#edf2f7',
            border: '1px solid #cbd5e0',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ margin: 0 }}>{statusNotice}</p>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          style={{
            padding: '1rem',
            backgroundColor: '#fff5f5',
            border: '1px solid #feb2b2',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            color: '#c53030',
          }}
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <fieldset style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1rem' }}>
          <legend style={{ fontWeight: 'bold' }}>심사용 플랜 선택</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {subscriptionOffers.map((offer) => (
              <label
                key={offer.code}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: isPending ? 'not-allowed' : 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="plan"
                  value={offer.code}
                  checked={selectedPlanCode === offer.code}
                  disabled={isPending}
                  onChange={() => setSelectedPlanCode(offer.code)}
                />
                <span>
                  <strong>{offer.name}</strong> — 월 {offer.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 (VAT 포함)
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="workspaceId" style={{ fontWeight: 'bold' }}>
            워크스페이스 식별자
          </label>
          <input
            id="workspaceId"
            type="text"
            required
            disabled={isPending}
            placeholder="워크스페이스 식별자 입력"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="fullName" style={{ fontWeight: 'bold' }}>
            담당자 이름
          </label>
          <input
            id="fullName"
            type="text"
            required
            disabled={isPending}
            placeholder="홍길동"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="email" style={{ fontWeight: 'bold' }}>
            담당자 이메일
          </label>
          <input
            id="email"
            type="email"
            required
            disabled={isPending}
            placeholder="reviewer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="phoneNumber" style={{ fontWeight: 'bold' }}>
            담당자 전화번호
          </label>
          <input
            id="phoneNumber"
            type="tel"
            required
            disabled={isPending}
            placeholder="010-1234-5678"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <fieldset style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1rem' }}>
          <legend style={{ fontWeight: 'bold' }}>필수 동의 항목</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                required
                disabled={isPending}
                checked={consentTerms}
                onChange={(e) => setConsentTerms(e.target.checked)}
              />
              <span>
                <Link href="/terms" target="_blank" rel="noopener noreferrer">
                  이용약관
                </Link>{' '}
                동의 (필수)
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                required
                disabled={isPending}
                checked={consentPrivacy}
                onChange={(e) => setConsentPrivacy(e.target.checked)}
              />
              <span>
                <Link href="/privacy" target="_blank" rel="noopener noreferrer">
                  개인정보 처리방침
                </Link>{' '}
                동의 (필수)
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                required
                disabled={isPending}
                checked={consentBillingReview}
                onChange={(e) => setConsentBillingReview(e.target.checked)}
              />
              <span>
                <Link href="/refund" target="_blank" rel="noopener noreferrer">
                  해지·환불 안내
                </Link>{' '}
                및 심사용 TEST 카드등록 확인 동의 (필수)
              </span>
            </label>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: isPending ? '#a0aec0' : '#3182ce',
            color: 'white',
            fontWeight: 'bold',
            borderRadius: '6px',
            border: 'none',
            cursor: isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? '요청 처리 중...' : 'TEST 카드등록창 열기'}
        </button>
      </form>
    </article>
  )
}
