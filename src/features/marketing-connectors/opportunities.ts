import {
  type ConnectorEvidence,
  type ConnectorId,
  isValidIsoDateString,
  selectUsableEvidence,
} from './evidence';

export type ConnectorOpportunityType = 'event_promotion' | 'faq_update';

export interface ConnectorOpportunity {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: ConnectorOpportunityType;
  readonly title: string;
  readonly reason: string;
  readonly sourceIds: readonly string[];
  readonly checklist: readonly string[];
  readonly suggestedAction: string;
  readonly expiresAt: string;
  readonly autoPublish: false;
  readonly derivedFromGoogle: boolean;
}

export interface CurrentConsentRecord {
  readonly connectorId: ConnectorId | string;
  readonly consentGeneration: number;
  readonly purpose: 'marketing' | 'booking' | string;
}

export interface BuildConnectorOpportunityInput {
  readonly workspaceId: string;
  readonly now: string;
  readonly currentConsents: readonly CurrentConsentRecord[];
  readonly evidence: readonly ConnectorEvidence[];
}

const MAX_OPPORTUNITY_COUNT = 5;

// Prompt injection patterns to strictly reject
const INJECTION_PATTERN =
  /(ignore\s+previous\s+instructions|system\s*:|execute\s+tool|delete_all|admin\s+permission|관리자\s*권한|지시를\s*무시하고)/i;

// PII patterns to redact (covers standard, spaced, dotted, and +82 phone numbers and emails)
const PHONE_PATTERN =
  /(?:\+?82[-.\s]?|0)(?:1[016789]|\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Explicit event keywords
const EVENT_KEYWORDS = /(행사|이벤트|팝업|원데이\s*클래스|페스티벌|플리마켓|전시회|워크숍|특별\s*모집)/i;

// Explicit FAQ / customer inquiry keywords
const FAQ_KEYWORDS = /(자주\s*묻는\s*질문|FAQ|Q&A|고객\s*문의|주차\s*안내|영업시간\s*안내)/i;

function redactSensitiveInfo(text: string): string {
  return text.replace(PHONE_PATTERN, '[연락처]').replace(EMAIL_PATTERN, '[이메일]');
}

export function buildConnectorOpportunity(
  input: BuildConnectorOpportunityInput,
): readonly ConnectorOpportunity[] {
  // 1. Strict validation (fail-closed)
  if (typeof input !== 'object' || input === null) return [];
  if (typeof input.workspaceId !== 'string' || input.workspaceId.trim() === '') return [];
  if (!isValidIsoDateString(input.now)) return [];
  if (!Array.isArray(input.currentConsents)) return [];
  if (!Array.isArray(input.evidence)) return [];

  // 2. Authoritative consent validation:
  // Reject any connector+purpose pair that has duplicate/conflicting generations (no generation union)
  const consentByPair = new Map<
    string,
    {
      connectorId: string;
      consentGeneration: number;
      purpose: 'marketing' | 'booking';
    }
  >();
  const conflictingPairs = new Set<string>();

  for (const consent of input.currentConsents) {
    if (typeof consent !== 'object' || consent === null) continue;
    if (typeof consent.connectorId !== 'string') continue;
    if (
      typeof consent.consentGeneration !== 'number' ||
      !Number.isInteger(consent.consentGeneration) ||
      consent.consentGeneration < 0
    ) {
      continue;
    }
    const purpose = consent.purpose;
    if (purpose !== 'marketing' && purpose !== 'booking') continue;

    const pairKey = `${consent.connectorId}:${purpose}`;
    if (consentByPair.has(pairKey)) {
      conflictingPairs.add(pairKey);
    } else {
      consentByPair.set(pairKey, {
        connectorId: consent.connectorId,
        consentGeneration: consent.consentGeneration,
        purpose,
      });
    }
  }

  for (const pairKey of conflictingPairs) {
    consentByPair.delete(pairKey);
  }

  // 3. Select usable evidence strictly using non-conflicting authoritative current consent records
  const usableEvidenceMap = new Map<string, ConnectorEvidence>();

  for (const consent of consentByPair.values()) {
    const usable = selectUsableEvidence({
      workspaceId: input.workspaceId,
      connectorId: consent.connectorId as ConnectorId,
      consentGeneration: consent.consentGeneration,
      now: input.now,
      purpose: consent.purpose,
      evidence: input.evidence,
    });

    for (const item of usable) {
      usableEvidenceMap.set(item.id, item);
    }
  }

  const verifiedEvidence = Array.from(usableEvidenceMap.values());
  const opportunities: ConnectorOpportunity[] = [];

  for (const item of verifiedEvidence) {
    if (typeof item !== 'object' || item === null) continue;
    if (typeof item.text !== 'string' || item.text.trim() === '') continue;

    // Security: known patterns best-effort screen; not execution authorization
    if (INJECTION_PATTERN.test(item.text)) {
      continue;
    }

    const safeText = redactSensitiveInfo(item.text);

    // Event promotion signal: explicit event keyword
    if (EVENT_KEYWORDS.test(safeText)) {
      const oppId = `opp-event-${item.workspaceId}-${item.connectorId}-${item.sourceId}-r${item.revision}`;

      opportunities.push({
        id: oppId,
        workspaceId: item.workspaceId,
        type: 'event_promotion',
        title: '행사 사전 안내 및 소식 등록',
        reason: '커넥터에서 관측된 행사 및 일정 정보를 바탕으로 사전 홍보 안내를 제안합니다.',
        sourceIds: [item.sourceId],
        checklist: [
          '행사 일시 및 장소가 현재 매장 실제 일정과 맞는지 확인',
          '참가 정원 또는 준비물 안내 사항 점검',
          'SNS 채널 및 네이버 플레이스 소식 등록 여부 결정',
        ],
        suggestedAction: '소식 피드 또는 인스타그램 스토리에 행사 일정 사전 안내 초안을 작성합니다.',
        expiresAt: item.expiresAt,
        autoPublish: false,
        derivedFromGoogle: item.derivedFromGoogle,
      });
      continue;
    }

    // FAQ update signal: explicit repeated question / guide
    if (FAQ_KEYWORDS.test(safeText)) {
      const oppId = `opp-faq-${item.workspaceId}-${item.connectorId}-${item.sourceId}-r${item.revision}`;

      opportunities.push({
        id: oppId,
        workspaceId: item.workspaceId,
        type: 'faq_update',
        title: '고객 자주 묻는 질문(FAQ) 업데이트',
        reason: '커넥터에서 자주 묻는 질문 또는 매장 이용 안내 사항이 확인되어 공지 갱신을 제안합니다.',
        sourceIds: [item.sourceId],
        checklist: [
          '답변 내용이 매장의 현재 운영 방침과 일치하는지 확인',
          '연락처 및 개인정보 노출 여부 점검',
          '프로필 링크 또는 고정 공지사항 등록 여부 결정',
        ],
        suggestedAction: '채널 하이라이트 또는 매장 공지사항에 이용 안내를 추가합니다.',
        expiresAt: item.expiresAt,
        autoPublish: false,
        derivedFromGoogle: item.derivedFromGoogle,
      });
    }
  }

  // 4. Stable deterministic sort by ID before capping
  opportunities.sort((a, b) => a.id.localeCompare(b.id));

  return opportunities.slice(0, MAX_OPPORTUNITY_COUNT);
}
