'use client'

import { useState, useTransition } from 'react'
import { billingPlanCatalog } from './billing-plan-catalog'
import { saveCheckoutIntentAction } from './actions/save-checkout-intent'
import styles from './billing-plan-selector.module.css'

export function BillingPlanSelector({ canSelect }: Readonly<{ canSelect: boolean }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function save(planCode: (typeof billingPlanCatalog)[number]['code'], label: string) {
    startTransition(async () => {
      const result = await saveCheckoutIntentAction({ planCode, idempotencyKey: crypto.randomUUID() })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMessage(`${label} 선택을 저장했습니다. 결제와 활성화는 아직 시작되지 않았습니다.`)
    })
  }

  return (
    <section aria-labelledby="billing-plan-title" className={styles.section}>
      <header>
        <h2 id="billing-plan-title">요금제 비교</h2>
        <p>요금제를 선택해도 결제 또는 활성화가 완료되지는 않습니다.</p>
      </header>
      <div className={styles.grid}>
        {billingPlanCatalog.map((plan) => (
          <article className={styles.card} key={plan.code}>
            <h3>{plan.label}</h3>
            <p className={styles.price}>{plan.monthlyPriceLabel}</p>
            <p>결제 기능 준비 중 · 원하는 요금제를 미리 찜해둘 수 있어요.</p>
            <button disabled={!canSelect || pending} onClick={() => save(plan.code, plan.label)} type="button">
              {canSelect ? `${plan.label} 선택 저장` : '관리자 권한 필요'}
            </button>
          </article>
        ))}
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </section>
  )
}
