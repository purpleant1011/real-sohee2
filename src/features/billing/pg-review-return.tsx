'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from '@/features/marketing/marketing.module.css'

export function PgReviewReturn() {
  const [status, setStatus] = useState<
    'idle' | 'verifying' | 'verified' | 'failed' | 'cancelled' | 'empty'
  >('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const processedRef = useRef(false)

  useEffect(() => {
    if (processedRef.current) return
    processedRef.current = true

    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    const billingKey = url.searchParams.get('billingKey')
    const code = url.searchParams.get('code')

    // Immediately remove sensitive query/hash from the browser history & address bar
    try {
      window.history.replaceState({}, document.title, window.location.pathname)
    } catch {
      // Safe fallback if history API is restricted
    }

    const runVerification = async () => {
      if (code) {
        // Failed or cancelled query from PG redirect - do not output raw code or message
        setStatus('cancelled')
        setNotice('인증키 등록 및 청구가 실행되지 않았습니다.')
        return
      }

      if (!billingKey) {
        setStatus('empty')
        setNotice('유효한 TEST 복귀 정보가 없습니다.')
        return
      }

      // Automatically send to verify endpoint without requiring user confirmation
      setStatus('verifying')

      try {
        const res = await fetch('/api/payments/review/billing-key/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billingKey }),
        })

        if (!res.ok) {
          setStatus('failed')
          setNotice('확인하지 못했습니다. 결제나 구독 활성화는 진행되지 않았습니다.')
          return
        }

        const data = await res.json()
        if (
          data?.status === 'verified_test_billing_key' &&
          data?.paymentCharged === false &&
          data?.subscriptionActivated === false
        ) {
          setStatus('verified')
          setNotice('테스트 빌링키 검증이 완료되었습니다. 실제 결제 및 구독 활성화는 실행되지 않았습니다.')
        } else {
          setStatus('failed')
          setNotice('확인하지 못했습니다. 결제나 구독 활성화는 진행되지 않았습니다.')
        }
      } catch {
        setStatus('failed')
        setNotice('확인하지 못했습니다. 결제나 구독 활성화는 진행되지 않았습니다.')
      }
    }

    void runVerification()
  }, [])

  return (
    <article className={styles.legalPage}>
      <header>
        <p className={styles.kicker}>PG 심사 전용</p>
        <h1>심사용 TEST 복귀 처리</h1>
        <p className={styles.legalLead}>
          카드등록창 리디렉션 후 복귀 결과를 서버와 대조하여 확인합니다.
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
          안내 고지
        </h2>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li>
            <strong>실제 청구 및 구독 활성화는 진행되지 않습니다.</strong>
          </li>
          <li>
            인증키 검증 성공 여부와 관계없이 실제 정기 결제나 과금은 차단되어 있습니다.
          </li>
        </ul>
      </section>

      {status === 'verifying' && (
        <div
          role="status"
          style={{
            padding: '1rem',
            backgroundColor: '#ebf8ff',
            border: '1px solid #90cdf4',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            color: '#2b6cb0',
          }}
        >
          <strong style={{ display: 'block' }}>서버 검증 진행 중...</strong>
          <p style={{ margin: '0.25rem 0 0' }}>리디렉션된 테스트 발급 정보를 서버에서 대조하고 있습니다.</p>
        </div>
      )}

      {status === 'verified' && (
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
          {notice && <p style={{ margin: '0.25rem 0 0' }}>{notice}</p>}
        </div>
      )}

      {(status === 'failed' || status === 'cancelled' || status === 'empty') && notice && (
        <div
          role="alert"
          style={{
            padding: '1rem',
            backgroundColor: '#edf2f7',
            border: '1px solid #cbd5e0',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <strong style={{ display: 'block', marginBottom: '0.25rem' }}>확인 결과</strong>
          <p style={{ margin: 0 }}>{notice}</p>
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <Link
          href="/pg-review"
          style={{
            display: 'inline-block',
            padding: '0.5rem 1rem',
            backgroundColor: '#edf2f7',
            color: '#2d3748',
            borderRadius: '6px',
            textDecoration: 'none',
            fontWeight: 'bold',
          }}
        >
          ← 심사용 TEST 화면으로 돌아가기
        </Link>
      </div>
    </article>
  )
}
