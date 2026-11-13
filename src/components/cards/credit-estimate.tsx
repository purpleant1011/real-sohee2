import { Coins } from 'lucide-react'
import { StatusBadge } from '@/components/status/status-badge'
import styles from './credit-estimate.module.css'

type CreditEstimateProps = Readonly<{
  availableCredits: number
  compact?: boolean
  estimatedCredits: number
  returnedCredits?: number
}>

export function CreditEstimate(props: CreditEstimateProps) {
  const { availableCredits, compact = false, estimatedCredits } = props
  const remainingCredits = availableCredits - estimatedCredits
  const isSufficient = remainingCredits >= 0

  if (isSufficient) {
    return null
  }

  return (
    <section className={styles.card} aria-label="이용 한도 알림" data-compact={compact ? 'true' : undefined}>
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true"><Coins /></span>
        <div>
          <p>이용 한도 안내</p>
          <strong>이용 한도에 도달했어요</strong>
        </div>
        <StatusBadge
          tone="review"
          label="한도 도달"
        />
      </div>
      <p style={{ margin: 0, color: 'var(--sohee-ink-soft)', fontSize: '0.8125rem', lineHeight: 1.5 }}>
        이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.
      </p>
    </section>
  )
}
