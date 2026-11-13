/**
 * Sohee V0.8.9 Versioned Legal Agreements & Delegation Engine
 * 
 * Invariants:
 * 1. Autonomous execution and channel write require explicit versioned agreements.
 * 2. Withdrawal of delegation immediately invalidates autonomous actions while preserving read-only access.
 */

export type AgreementType =
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_POLICY'
  | 'AI_DATA_PROCESSING'
  | 'CHANNEL_DELEGATION_POA'
  | 'AUTONOMOUS_AGENT_AUTHORITY'
  | 'MARKETING_NOTIFICATIONS';

export interface AgreementDefinition {
  type: AgreementType;
  title: string;
  version: string;
  isRequired: boolean;
  summary: string;
  fullTextUrl: string;
}

export const CURRENT_AGREEMENTS: AgreementDefinition[] = [
  {
    type: 'TERMS_OF_SERVICE',
    title: '소희 서비스 이용약관',
    version: '2026.09.02',
    isRequired: true,
    summary: '소희 AI 마케팅 솔루션의 상용 서비스 이용 조건 및 책임 범위를 규정합니다.',
    fullTextUrl: '/terms'
  },
  {
    type: 'PRIVACY_POLICY',
    title: '개인정보 처리방침',
    version: '2026.09.02',
    isRequired: true,
    summary: '회원 및 매장 고객 데이터의 수집, 이용 목적, 안전한 암호화 보관 정책을 안내합니다.',
    fullTextUrl: '/privacy'
  },
  {
    type: 'AI_DATA_PROCESSING',
    title: 'AI 데이터 처리 및 분석 동의',
    version: '2026.09.02',
    isRequired: true,
    summary: '매장 정보 및 마케팅 채널 데이터를 활용한 AI 에이전트의 맞춤형 콘텐츠 생성 및 의도 분석을 승인합니다.',
    fullTextUrl: '/legal/ai-processing'
  },
  {
    type: 'CHANNEL_DELEGATION_POA',
    title: '마케팅 채널 운영 대행 위임 동의',
    version: '2026.09.02',
    isRequired: true,
    summary: '연결된 4대 마케팅 채널(인스타그램, 스레드, 네이버 블로그, 당근)에 대한 포스팅 대행 권한을 위임합니다.',
    fullTextUrl: '/legal/channel-delegation'
  },
  {
    type: 'AUTONOMOUS_AGENT_AUTHORITY',
    title: '자율 에이전트 정책 및 사전 승인 위임',
    version: '2026.09.02',
    isRequired: true,
    summary: '설정된 정책(Policy)과 크레딧 한도 내에서 소희가 자율적으로 마케팅 기회를 포착하고 실행함을 승인합니다.',
    fullTextUrl: '/legal/autonomy-delegation'
  },
  {
    type: 'MARKETING_NOTIFICATIONS',
    title: '마케팅 성과 및 혜택 알림 수신 동의 (선택)',
    version: '2026.09.02',
    isRequired: false,
    summary: '일일 마케팅 브리핑 및 주간 성과 보고서 알림을 받습니다.',
    fullTextUrl: '/legal/marketing-notice'
  }
];

export interface UserAgreementRecord {
  userId: string;
  workspaceId: string;
  agreementType: AgreementType;
  version: string;
  agreed: boolean;
  agreedAt: string;
  ipAddress?: string;
}

/**
 * 필수 약관 전수 동의 여부 검증
 */
export function validateRequiredAgreements(records: UserAgreementRecord[]): {
  isFullyCompliant: boolean;
  missingAgreements: AgreementType[];
} {
  const agreedTypes = new Set(
    records.filter(r => r.agreed).map(r => r.agreementType)
  );

  const missing: AgreementType[] = [];

  for (const def of CURRENT_AGREEMENTS) {
    if (def.isRequired && !agreedTypes.has(def.type)) {
      missing.push(def.type);
    }
  }

  return {
    isFullyCompliant: missing.length === 0,
    missingAgreements: missing
  };
}
