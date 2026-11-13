import Link from 'next/link'
import styles from '@/features/marketing/marketing.module.css'
import { subscriptionOfferPolicy } from '@/features/billing/subscription-offers'

export default function RefundPage() {
  const { cancellation } = subscriptionOfferPolicy

  return (
    <article className={styles.legalPage}>
      <p className={styles.kicker}>안내</p>
      <h1>해지·환불 안내</h1>
      <p className={styles.legalLead}>
        소희(SOHEE)의 정기 구독 해지 및 환불에 관한 기본 원칙과 현재 제공 상태를 안내합니다.
      </p>

      <div className={styles.legalSections}>
        <section>
          <h2>{cancellation.label}</h2>
          <p>{cancellation.notice}</p>
        </section>

        <section>
          <h2>환불 및 법정 권리 안내</h2>
          <p>{cancellation.refundNotice}</p>
          <p>
            구체적인 환불 계산식과 처리기한은 아직 확정되지 않았습니다. 현재는 PG사 심사 및 정식 오픈 준비 중으로 유료 플랜 판매 및 자동청구가 차단된 상태입니다.
          </p>
        </section>

        <section>
          <h2>온라인 신청 및 접수 안내</h2>
          <p>
            현재 시스템 내 온라인 해지·환불 요청 기능은 아직 제공하지 않습니다.
          </p>
          <p>
            관련 문의나 접수가 필요하신 경우 고객지원 이메일(
            <a href="mailto:support@example.com">support@example.com</a>
            )로 연락해 주시기 바랍니다.
          </p>
        </section>

        <section>
          <h2>관련 안내</h2>
          <p>
            제공 예정인 플랜과 범위는 <Link href="/pricing">요금 안내</Link>에서, 서비스 이용의 기본 조건은{' '}
            <Link href="/terms">이용약관</Link>에서 확인하실 수 있습니다.
          </p>
        </section>
      </div>
    </article>
  )
}
