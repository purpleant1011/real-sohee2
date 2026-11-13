import Link from 'next/link'
import { subscriptionOffers, subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import styles from '@/features/marketing/v085-marketing.module.css'

export default function PricingPage() {
  return (
    <div className={styles.detailPage}>
      <header className={styles.detailIntro}>
        <p>월 구독 요금 안내 · 판매 준비 중</p>
        <h1>내 매장의 운영 범위에 맞춰 시작하세요.</h1>
        <span>{subscriptionOfferPolicy.notice}</span>
      </header>
      <div className={styles.priceGrid}>
        {subscriptionOffers.map((plan) => (
          <section key={plan.code}>
            <header><h2>{plan.name}</h2><strong>월 {plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원</strong></header>
            <p>부가가치세(VAT) 포함</p>
            <dl>
              <div><dt>상품 유형</dt><dd>AI 모델·기능 이용권</dd></div>
              <div><dt>제공 범위</dt><dd>요금제별 모델·기능·한도 확정 후 안내</dd></div>
              <div><dt>서비스 제공기간</dt><dd>{subscriptionOfferPolicy.servicePeriod.label}</dd></div>
              <div><dt>해지 기준</dt><dd>{subscriptionOfferPolicy.cancellation.label}</dd></div>
              <div><dt>이용 조건</dt><dd>자동갱신·환불 조건과 PG 연동 확인 전 구매 불가</dd></div>
            </dl>
            <button type="button" disabled>결제 준비 중</button>
          </section>
        ))}
      </div>
      <section aria-label="요금 안내" className={styles.pricingNotice}>
        <strong>결제는 아직 연결되지 않았습니다.</strong>
        <p>광고비 별도</p>
        <p>{subscriptionOfferPolicy.purchaseNotice}</p>
        <p>{subscriptionOfferPolicy.servicePeriod.boundaryNotice}</p>
        <p>{subscriptionOfferPolicy.cancellation.notice}</p>
        <p>{subscriptionOfferPolicy.cancellation.refundNotice}</p>
        <p>{subscriptionOfferPolicy.creditNotice}</p>
        <p>예약금 수납과 매장 정산은 이 구독 상품에 포함되지 않으며, 별도 계약 승인 전 제공하지 않습니다.</p>
        <p><Link href="/terms">이용약관</Link> · <Link href="/privacy">개인정보 처리방침</Link> · <Link href="/payment-info">결제 안내</Link> · <Link href="/refund">해지·환불 안내</Link></p>
        <p>문의: <a href="mailto:support@example.com">support@example.com</a></p>
      </section>
    </div>
  )
}
