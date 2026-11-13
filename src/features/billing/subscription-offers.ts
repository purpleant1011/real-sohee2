import { subscriptionServicePeriodPolicy } from './subscription-period'

/**
 * 신규 구독 제안: 모델·기능 이용권이며 크레딧 지급 상품이 아니다.
 * 사용자 확정: 월 15/30/50만원은 VAT 포함 최종 결제금액이다.
 * 기능 한도·제공 조건·PG 계약 검증이 완료되기 전에는 판매하지 않는다.
 * 레거시 billing_plans 및 기존 고객 원장을 변경하거나 활성화하는 용도로 쓰지 않는다.
 */
export const subscriptionOffers = Object.freeze([
  { code: 'STARTER_150K', name: '기본 마케팅 직원', monthlyTotalPriceKrw: 150000, vatIncluded: true },
  { code: 'GROWTH_300K', name: '고성장 전담 직원', monthlyTotalPriceKrw: 300000, vatIncluded: true },
  { code: 'SCALE_500K', name: '최상위 총괄', monthlyTotalPriceKrw: 500000, vatIncluded: true },
] as const)

export const subscriptionOfferPolicy = Object.freeze({
  version: 'subscription-feature-access-monthly-cancellation-period-end-draft-2026-11-06',
  servicePeriod: subscriptionServicePeriodPolicy,
  kind: 'feature_access',
  creditGrant: 'none',
  saleStatus: 'blocked_pending_policy_and_contract',
  cancellation: Object.freeze({
    label: '다음 갱신부터 해지',
    effectiveAt: 'current_period_end',
    retainCurrentPeriod: true,
    stopNextRenewalCharge: true,
    refundHandling: 'separate',
    notice: '해지 시 현재 결제된 이용기간은 유지되며 다음 갱신 결제 중단이 적용됩니다.',
    refundNotice: '이미 결제된 요금의 환불 처리는 별도 접수 및 정책에 따르며, 전자상거래법 등 관계 법령에 따른 권리를 제한하지 않습니다.',
  } as const),
  notice: '월 구독에 크레딧을 지급하지 않습니다. AI 모델과 기능별 이용 범위를 기준으로 제공하며, 요금제별 세부 범위와 한도는 확정 후 안내합니다.',
  purchaseNotice: '표시된 월 구독료는 부가가치세를 포함한 최종 결제금액입니다. 자동갱신·환불 조건을 확정하고 PG 연동을 확인한 후 결제를 제공합니다. 현재는 결제나 자동청구를 진행하지 않습니다.',
  creditNotice: '크레딧은 월 구독과 별도 상품으로 분리합니다. 현재 추가 크레딧 구매는 제공하지 않으며, PG 승인과 별도 정책 확정 전 판매하지 않습니다.',
} as const)
