import { CreditEstimate } from '@/components/cards/credit-estimate'
import type { PeriodPlanAdjustment } from '@/features/plans/types'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import styles from './credit-estimate-card.module.css'

export type CreditEstimateCardArtifact = Readonly<{
  id: string
  catalogVersion: number
  estimatedCredits: number
  availableCredits: number
  expectedRemainingCredits: number
  status: 'ready' | 'insufficient'
  adjustments: readonly PeriodPlanAdjustment[]
}>

export function CreditEstimateCard({ artifact }: Readonly<{ artifact: CreditEstimateCardArtifact }>) {
  const mobile = useMobileR2Active()

  if (artifact.status !== 'insufficient') {
    return null
  }

  if (mobile) {
    return (
      <section aria-label="이용 한도 확인" className={styles.card}>
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <span>이용 한도에 도달했어요</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.
        </p>
        {artifact.adjustments.length > 0 ? (
          <div className={styles.adjustments}>
            <strong>계획은 그대로 두고 범위를 조정할 수 있어요.</strong>
            <ul>{artifact.adjustments.map((item) => <li key={item.kind}>{item.label}</li>)}</ul>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section aria-label="이용 한도 안내" className={styles.card}>
      <CreditEstimate
        availableCredits={artifact.availableCredits}
        estimatedCredits={artifact.estimatedCredits}
      />
      <div className={styles.adjustments}>
        <strong>계획은 그대로 두고 범위를 조정할 수 있어요.</strong>
        <ul>{artifact.adjustments.map((item) => <li key={item.kind}>{item.label}</li>)}</ul>
      </div>
      <div className={styles.boundary}>
        <p>현재 계획은 저장되거나 예약되지 않았어요.</p>
      </div>
    </section>
  )
}
