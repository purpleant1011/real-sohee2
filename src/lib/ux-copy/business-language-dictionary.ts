/**
 * UX Copy & Business Language Dictionary (ANI-1239)
 * 
 * Purges internal technical operator jargon (Provider, Receipt, Webhook, Ingress, Readback)
 * and standardizes owner-facing text into intuitive Korean business language.
 */

export const FORBIDDEN_TECHNICAL_WORDS = [
  'Provider',
  'Receipt',
  'Trace',
  'Webhook',
  'Ingress',
  'Readback',
  'Payload',
  'Idempotency',
  'Partition',
] as const;

export interface ForbiddenScanResult {
  hasForbiddenTerms: boolean;
  detectedTerms: string[];
}

/**
 * Scans owner-facing text for forbidden internal technical words.
 */
export function scanForbiddenTechnicalTerms(text: string): ForbiddenScanResult {
  const detectedTerms: string[] = [];

  for (const term of FORBIDDEN_TECHNICAL_WORDS) {
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(text)) {
      detectedTerms.push(term);
    }
  }

  return {
    hasForbiddenTerms: detectedTerms.length > 0,
    detectedTerms,
  };
}

const STATUS_BUSINESS_MAP: Record<string, string> = {
  RECEIVED: '새로운 업무 요청 접수됨',
  DRAFTED: '소희가 업무 초안 작성을 완료했어요',
  AWAITING_APPROVAL: '사장님의 확인을 기다리고 있어요',
  APPROVED: '승인 완료 및 실행 준비 중',
  EXECUTING: '소희가 업무를 진행하고 있어요',
  PUBLISHED_VERIFIED: '게시 및 발행 확인 완료',
  LISTENING: '고객 반응 및 새 문의 확인 중',
  CUSTOMER_ENGAGED: '고객과 실시간 상담 및 슬롯 조율 중',
  BOOKED: '고객 예약 확정 완료',
  RESULT_UNKNOWN: '외부 채널 확인 중 (잠시 후 다시 안내해 드릴게요)',
  ATTRIBUTED_CLOSED: '성과 검증 완료 및 마감',
  FAILED: '업무 일시 중단 (확인이 필요해요)',
  CANCELLED: '업무 취소 완료',
};

/**
 * Translates internal technical statuses to friendly Korean small-business language.
 */
export function toBusinessLanguage(technicalStatusCode: string): string {
  return STATUS_BUSINESS_MAP[technicalStatusCode] || technicalStatusCode;
}

export interface ThreeStepErrorInput {
  whatHappened: string;
  whatSoheeDid: string;
  whatOwnerShouldDo: string;
}

export interface ThreeStepErrorOutput extends ThreeStepErrorInput {
  fullSummary: string;
}

/**
 * Standardizes error copy into the 3-step actionable structure:
 * 1. 상황 (무슨 일이 일어났는지)
 * 2. 소희의 조치 (소희가 무엇을 처리했는지)
 * 3. 사장님 확인 (사장님이 무엇을 결정/확인해야 하는지)
 */
export function formatThreeStepErrorCopy(input: ThreeStepErrorInput): ThreeStepErrorOutput {
  const { whatHappened, whatSoheeDid, whatOwnerShouldDo } = input;

  const fullSummary = [
    `1. 상황: ${whatHappened}`,
    `2. 소희의 조치: ${whatSoheeDid}`,
    `3. 사장님 확인: ${whatOwnerShouldDo}`,
  ].join('\n');

  return {
    whatHappened,
    whatSoheeDid,
    whatOwnerShouldDo,
    fullSummary,
  };
}
