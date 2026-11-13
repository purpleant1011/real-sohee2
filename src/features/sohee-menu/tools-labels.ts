/**
 * 사장님용 액션 능력(Tools) 라벨 및 위험도(RiskTier) 매핑
 * 내부 용어(R0/R1/R2, riskTier, Harness 등)와 영문 카테고리를 친절한 한국어 문구로 변환합니다.
 */

export const RISK_TIER_LABELS: Record<string, string> = {
  R0: '바로 해요',
  LOW: '바로 해요',
  R1: '물어보고 해요',
  MEDIUM: '물어보고 해요',
  HIGH: '물어보고 해요',
  R2: '하지 않아요',
  IRREVERSIBLE: '하지 않아요',
  CRITICAL: '하지 않아요',
}

export const CATEGORY_LABELS: Record<string, string> = {
  CONTENT: '콘텐츠',
  PUBLISHING: '발행',
  CUSTOMER_CRM: '고객 관리',
  PROMOTION: '홍보·이벤트',
  RADAR: '트렌드 탐색',
  ANALYTICS: '성과 분석',
  HARNESS: '가게 맞춤 설정',
  SYSTEM: '시스템 설정',
  EXPERIMENT: '실험·테스트',
}

/**
 * 위험도(riskTier)를 사장님 친화적 한국어로 변환합니다.
 * 알 수 없는 값은 "확인 후 해요" 기본값을 반환합니다.
 */
export function getRiskTierLabel(riskTier?: string): string {
  if (!riskTier) return '확인 후 해요'
  return RISK_TIER_LABELS[riskTier] ?? '확인 후 해요'
}

/**
 * 카테고리(category)를 사장님 친화적 한국어로 변환합니다.
 * 미지정이거나 매핑되지 않은 값은 "기타"를 반환합니다.
 */
export function getCategoryLabel(category?: string): string {
  if (!category) return '기타'
  return CATEGORY_LABELS[category] ?? '기타'
}
