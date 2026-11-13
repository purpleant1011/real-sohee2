/**
 * 마케팅 커넥터 목적 및 사용 정책 (MC-15)
 *
 * [중요 정책 명시]
 * 1. 범용 모델 가중치 학습('model_training')은 공급자 무관(Google 및 비-Google 전체) 전면 금지 (반드시 deny).
 * 2. Google API 데이터와 그 파생물에 대해 'marketing' 및 'booking' 목적이 허용(true)되는 것은
 *    소희 서비스 내의 "로컬 업무보조(local business-assistance) 정책" 기준에 따른 허용일 뿐이며,
 *    Google 공급자 측의 실제 프로덕션 출시 허가(provider launch permission)나 보안 평가 승인을 의미하는 것이 아닙니다.
 * 3. Google Workspace API User Data Policy에 따라 Google 파생 데이터는:
 *    - 광고 플랫폼 전달 / 리타기팅 / 개인 맞춤 광고('advertising') 용도로 사용 불가 (반드시 deny)
 *    - 범용 모델 가중치 학습('model_training') 용도로 사용 불가 (반드시 deny)
 *
 * 모든 입력은 런타임에서 fail-closed 방식으로 검증됩니다.
 */

export type ConnectorUsagePurpose =
  | 'marketing'
  | 'booking'
  | 'advertising'
  | 'model_training';

export interface ConnectorUsagePolicyInput {
  derivedFromGoogle: boolean;
  purpose: ConnectorUsagePurpose;
}

export const POLICY_DISCLOSURE = Object.freeze({
  googleAssistanceOnly: true,
  notice:
    'Google API 데이터의 마케팅/예약 목적 사용 허용은 로컬 업무보조 정책 기준일 뿐이며 공급자 출시허가가 아닙니다. 범용 모델 학습은 공급자 무관 전면 금지됩니다.',
  prohibitedUniversalPurposes: Object.freeze(['model_training'] as const),
  prohibitedGooglePurposes: Object.freeze(['advertising', 'model_training'] as const),
  allowedPurposes: Object.freeze([
    'marketing',
    'booking',
    'advertising',
  ] as const),
});

/**
 * 커넥터 데이터 사용 목적 허용 여부 판정 (런타임 fail-closed)
 *
 * @param input 검증 대상 객체
 * @returns 허용 여부 (true: 허용, false: 거부)
 */
export function isConnectorUsageAllowed(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Record<string, unknown>;

  if (typeof candidate.derivedFromGoogle !== 'boolean') {
    return false;
  }

  if (typeof candidate.purpose !== 'string') {
    return false;
  }

  const validPurposes: readonly string[] = [
    'marketing',
    'booking',
    'advertising',
    'model_training',
  ];

  if (!validPurposes.includes(candidate.purpose)) {
    return false;
  }

  // Universal constraint: 범용 모델 가중치 학습은 공급자 무관 전면 금지
  if (candidate.purpose === 'model_training') {
    return false;
  }

  // Google Limited Use Policy:
  // Google API 데이터와 파생물은 광고 플랫폼 전달·타기팅에 사용할 수 없습니다.
  if (candidate.derivedFromGoogle && candidate.purpose === 'advertising') {
    return false;
  }

  // 허용 목적:
  // 'marketing', 'booking'은 로컬 업무보조 정책 기준 허용 (Google 출시허가 아님)
  // 'advertising'은 비-Google 소스에 한해 허용
  return true;
}
