'use client'

import NumberFlow from '@number-flow/react'
import styles from './account-readiness-metric.module.css'

export function AccountReadinessMetric({ percentage, readyCount }: Readonly<{ percentage: number; readyCount: number }>) {
  return (
    <div aria-label={`소희 준비도 ${percentage}퍼센트`} className={styles.metric} role="status">
      <strong><NumberFlow suffix="%" value={percentage} /></strong>
      <span>{readyCount}/6 준비</span>
    </div>
  )
}
