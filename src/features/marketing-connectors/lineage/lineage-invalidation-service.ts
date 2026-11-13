import type { ConnectorId } from '../catalog';
import type { MarketingConnectorEvidenceRecord, EvidenceGateway } from '../evidence/evidence-repository';
import type { MarketingConsentRecord, ConsentLedgerGateway } from '../consent/consent-ledger';

export const EXTERNAL_PUBLISHED_REVOCATION_NOTICE =
  '외부 자동 삭제 불가(사용자 직접 삭제 필요) 및 신규 정보 활용 중단';

export interface ValidateLineageInput {
  readonly workspaceId: string;
  readonly actionId: string;
  readonly evidenceIds: readonly string[];
  readonly alreadyPublished?: boolean;
  readonly now?: string;
  readonly actionType?: 'proposal' | 'draft' | 'mission' | string;
}

export interface LineageGateway {
  getEvidenceById?(
    workspaceId: string,
    evidenceId: string
  ): Promise<MarketingConnectorEvidenceRecord | null>;
  getEvidenceBatch?(
    workspaceId: string,
    evidenceIds: readonly string[]
  ): Promise<readonly (MarketingConnectorEvidenceRecord | null)[]>;
  getLatestConsent?(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<MarketingConsentRecord | null>;
  evidenceGateway?: EvidenceGateway;
  consentGateway?: ConsentLedgerGateway;
}

export interface ValidLineageResult {
  readonly ok: true;
  readonly activeEvidenceCount: number;
}

export interface RevokedLineageResult {
  readonly ok: false;
  readonly code: 'LINEAGE_REVOKED';
  readonly reason: string;
  readonly invalidatedEvidenceIds: readonly string[];
  readonly alreadyPublished?: boolean;
  readonly notice?: string;
}

export type ValidateLineageResult = ValidLineageResult | RevokedLineageResult;

/**
 * 자료 삭제 또는 동의 철회 시 파생된 제안, 초안, 미션의 실행을 차단(LINEAGE_REVOKED)하는 서비스 함수.
 * Fail-Closed 원칙에 따라 검증 불능이나 오류 발생 시에도 실행을 안전하게 차단한다.
 */
export async function validateLineageForExecution(
  input: ValidateLineageInput,
  gateway: LineageGateway
): Promise<ValidateLineageResult> {
  // Fail-closed validation for required input fields
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.workspaceId !== 'string' ||
    input.workspaceId.trim() === '' ||
    typeof input.actionId !== 'string' ||
    input.actionId.trim() === '' ||
    !Array.isArray(input.evidenceIds)
  ) {
    return {
      ok: false,
      code: 'LINEAGE_REVOKED',
      reason: '유효하지 않은 요청 파라미터입니다.',
      invalidatedEvidenceIds: [],
    };
  }

  const now = input.now ?? new Date().toISOString();
  const invalidatedEvidenceIds: string[] = [];

  try {
    // 1. 근거 레코드 일괄/개별 조회
    const evidenceList: Array<{ id: string; record: MarketingConnectorEvidenceRecord | null }> = [];

    if (typeof gateway.getEvidenceBatch === 'function') {
      const records = await gateway.getEvidenceBatch(input.workspaceId, input.evidenceIds);
      for (let i = 0; i < input.evidenceIds.length; i++) {
        evidenceList.push({
          id: input.evidenceIds[i],
          record: records[i] ?? null,
        });
      }
    } else if (typeof gateway.getEvidenceById === 'function') {
      for (const id of input.evidenceIds) {
        const record = await gateway.getEvidenceById(input.workspaceId, id);
        evidenceList.push({ id, record });
      }
    } else {
      // 게이트웨이에 근거 조회 수단이 없는 경우 fail-closed
      return {
        ok: false,
        code: 'LINEAGE_REVOKED',
        reason: '근거 자료를 조회할 수 있는 게이트웨이 인터페이스가 제공되지 않았습니다.',
        invalidatedEvidenceIds: [...input.evidenceIds],
      };
    }

    // 2. 동의 레코드 캐시 (동일 커넥터 중복 조회 방지)
    const consentCache = new Map<ConnectorId, MarketingConsentRecord | null>();

    const getConsent = async (connectorId: ConnectorId): Promise<MarketingConsentRecord | null> => {
      if (consentCache.has(connectorId)) {
        return consentCache.get(connectorId)!;
      }

      let consent: MarketingConsentRecord | null = null;
      if (typeof gateway.getLatestConsent === 'function') {
        consent = await gateway.getLatestConsent(input.workspaceId, connectorId);
      } else if (gateway.consentGateway && typeof gateway.consentGateway.getLatestConsent === 'function') {
        consent = await gateway.consentGateway.getLatestConsent(input.workspaceId, connectorId);
      }

      consentCache.set(connectorId, consent);
      return consent;
    };

    // 3. 각 근거의 현재 원장 상태 검증
    for (const { id, record } of evidenceList) {
      // 3-1. 원장에 근거 레코드가 없음 (삭제되었거나 미존재)
      if (!record) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 3-2. 이미 철회된 근거 (revokedAt !== null)
      if (record.revokedAt !== null) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 3-3. 근거 만료 기한 경과 (expiresAt < now)
      if (record.expiresAt < now) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 3-4. 커넥터 동의 상태 검증
      const consent = await getConsent(record.connectorId);
      if (!consent) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 동의 상태가 active가 아님 (철회됨)
      if (consent.status !== 'active') {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // AI 처리 미동의
      if (!consent.aiProcessingApproved) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 동의 유효기한 경과
      if (consent.validUntil < now) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 근거의 동의 세대가 현재 동의 세대보다 이전 세대인 경우
      if (record.consentGeneration < consent.consentGeneration) {
        invalidatedEvidenceIds.push(id);
        continue;
      }

      // 근거의 출처(sourceId)가 현재 허용 출처 목록에서 제거된 경우
      if (!consent.allowedSourceIds.includes(record.sourceId)) {
        invalidatedEvidenceIds.push(id);
        continue;
      }
    }

    // 4. 차단 여부 판정
    if (invalidatedEvidenceIds.length > 0) {
      if (input.alreadyPublished) {
        return {
          ok: false,
          code: 'LINEAGE_REVOKED',
          reason: EXTERNAL_PUBLISHED_REVOCATION_NOTICE,
          notice: EXTERNAL_PUBLISHED_REVOCATION_NOTICE,
          invalidatedEvidenceIds,
          alreadyPublished: true,
        };
      }

      return {
        ok: false,
        code: 'LINEAGE_REVOKED',
        reason: `근거 자료(${invalidatedEvidenceIds.join(', ')})가 철회되었거나 만료되어 실행이 차단되었습니다.`,
        invalidatedEvidenceIds,
        alreadyPublished: false,
      };
    }

    // 5. 모든 근거가 정상인 경우
    return {
      ok: true,
      activeEvidenceCount: input.evidenceIds.length,
    };
  } catch (error) {
    // Fail-Closed: 예상치 못한 예외 발생 시 안전하게 실행 차단
    return {
      ok: false,
      code: 'LINEAGE_REVOKED',
      reason: `원장 상태 조회 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
      invalidatedEvidenceIds: [...input.evidenceIds],
    };
  }
}

/**
 * Lineage Invalidation Service 클래스 래퍼
 */
export class LineageInvalidationService {
  constructor(private readonly gateway: LineageGateway) {}

  async validateLineageForExecution(input: ValidateLineageInput): Promise<ValidateLineageResult> {
    return validateLineageForExecution(input, this.gateway);
  }
}
