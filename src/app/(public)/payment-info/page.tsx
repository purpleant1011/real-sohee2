import type { Metadata } from 'next'
import Link from 'next/link'
import { subscriptionOffers, subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import { LegalDocument, OperatorNote, type LegalArticle } from '../legal-document'

export const metadata: Metadata = {
  title: '결제 안내 | 소희',
  description: '소희(example.com)의 요금제 구성, 부가가치세, 결제 수단 및 세금계산서 발행 안내입니다.',
}

const paymentArticles: readonly LegalArticle[] = [
  {
    id: 'pricing-and-vat',
    title: '요금제 및 부가가치세',
    articleNumber: '제1조',
    content: (
      <div>
        <p>
          1. <strong>현재 상태 안내:</strong> 결제는 아직 연결되지 않았습니다. {subscriptionOfferPolicy.purchaseNotice}
        </p>
        <p>
          2. 소희의 플랜별 기준 요금은 다음과 같으며, <strong>표시된 월 구독료는 부가가치세(VAT)를 포함한 최종 결제금액</strong>입니다.
        </p>
        <ul>
          {subscriptionOffers.map((plan) => (
            <li key={plan.code}>
              <strong>{plan.name}:</strong> 월 {plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 (부가가치세 포함)
            </li>
          ))}
        </ul>
        <p>
          3. <strong>상품 유형:</strong> {subscriptionOfferPolicy.notice}
        </p>
        <p>
          4. <strong>크레딧 정책:</strong> {subscriptionOfferPolicy.creditNotice}
        </p>
        <OperatorNote item="연간 결제 옵션 도입 여부 및 프로모션 할인 기준 확정" />
      </div>
    ),
  },
  {
    id: 'payment-methods',
    title: '지원 결제 수단',
    articleNumber: '제2조',
    content: (
      <div>
        <p>
          1. 결제는 아직 연결되지 않았습니다. 향후 PG 연동 확인 후 결제를 제공합니다.
        </p>
        <p>
          2. 상용 결제 개시 시, 매장의 원활한 경비 처리를 위해 다양한 결제 수단을 지원할 예정입니다.
        </p>
        <p>
          3. 현재는 결제창 연동 전으로 결제수단 등록이나 카드 정보 저장이 지원되지 않습니다.
        </p>
        <OperatorNote item="상용 결제 연동 결제 수단(국내 신용/체크카드, 법인카드, 간편결제 등) 확정" />
      </div>
    ),
  },
  {
    id: 'service-period-and-renewal',
    title: '제공기간·청구 주기·해지 기준',
    articleNumber: '제3조',
    content: (
      <div>
        <p>
          1. <strong>서비스 제공기간:</strong> {subscriptionOfferPolicy.servicePeriod.label} 기준이며, {subscriptionOfferPolicy.servicePeriod.boundaryNotice}
        </p>
        <p>
          2. <strong>청구 주기 및 자동 갱신:</strong> 유료 정기구독 서비스는 첫 결제 승인일을 기준으로 매월 동일한 일자에 등록된 결제수단으로 자동 청구(정기결제 자동 갱신)되는 방식으로 운영될 예정입니다.
        </p>
        <p>
          3. <strong>해지 기준:</strong> {subscriptionOfferPolicy.cancellation.label} 기준을 적용하며, {subscriptionOfferPolicy.cancellation.notice}
        </p>
        <p>
          4. <strong>환불 및 법정 권리 안내:</strong> {subscriptionOfferPolicy.cancellation.refundNotice} 세부 환불 안내 및 접수는 <Link href="/refund">해지·환불 안내</Link> 페이지를 확인해 주시기 바랍니다.
        </p>
        <OperatorNote item="자동 갱신 결제일 사전 알림 발송 시점 및 고지 절차 확정" />
        <OperatorNote item="카드 한도 초과 또는 잔액 부족 등 결제 실패 시 자동 재시도 일정 및 서비스 이용 유예 기간 확정" />
      </div>
    ),
  },
  {
    id: 'receipts-and-tax-invoices',
    title: '영수증 및 세금계산서 신청',
    articleNumber: '제4조',
    content: (
      <div>
        <p>
          1. <strong>신용카드 매출전표:</strong> 신용카드 정기결제 완료 시, 전자상거래법 및
          부가가치세법에 따른 신용카드 매출전표가 자동 발급되며 서비스 내 결제 내역 화면에서 즉시
          확인 및 인쇄할 수 있습니다.
        </p>
        <p>
          2. <strong>전자세금계산서:</strong> 사업자등록번호 및 세금계산서 전담 수신 이메일을 등록한
          사업자 회원의 경우, 결제 확인 후 국세청 전송 전자세금계산서가 발행됩니다.
        </p>
        <OperatorNote item="전자세금계산서 연동 대행 업체 및 월별 발행 마감 기준 확정" />
      </div>
    ),
  },
  {
    id: 'payment-inquiries',
    title: '결제 및 증빙 관련 문의',
    articleNumber: '제5조',
    content: (
      <div>
        <p>
          결제 내역, 요금제, 세금계산서 발행 및 증빙 서류에 관한 모든 문의는 공식 지원 이메일(
          <a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>
          ) 또는 고객센터({OPERATOR_INFO.phone})로 연락해 주시면 신속히 안내해 드립니다.
        </p>
      </div>
    ),
  },
]

export default function PaymentInfoPage() {
  return (
    <LegalDocument
      articles={paymentArticles}
      description="소희(example.com)의 플랜별 요금 체계, 부가가치세 적용 기준, 결제 주기 및 세금계산서 발행 방법을 안내합니다."
      effectiveDate="확정 전 (초안)"
      title="결제 안내"
    />
  )
}
