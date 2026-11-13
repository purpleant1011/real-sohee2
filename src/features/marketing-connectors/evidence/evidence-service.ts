import type { ConnectorId } from '../catalog';
import {
  verifySourceAccess,
  type ConsentLedgerGateway,
  type ConsentPurpose,
} from '../consent/consent-ledger';
import {
  saveEvidenceBatch as saveBatchToRepository,
  listActiveEvidence as listActiveFromRepository,
  type EvidenceGateway,
  type MarketingConnectorEvidenceRecord,
  type SaveEvidenceItemInput,
  type ListActiveEvidenceParams,
} from './evidence-repository';

export const SKEW_FUTURE_LIMIT = 'SKEW_FUTURE_LIMIT';
export const SKEW_FUTURE_LIMIT_SECONDS = 300;
export const SKEW_FUTURE_LIMIT_MS = SKEW_FUTURE_LIMIT_SECONDS * 1000;
export const MAX_RETENTION_DAYS = 30;
export const MAX_RETENTION_MS = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class EvidenceValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.code = code;
  }
}

export interface IngestEvidenceItemInput {
  readonly id?: string;
  readonly sourceId: string;
  readonly revision: string;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly text: string;
  readonly derivedFromGoogle: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface IngestEvidenceBatchInput {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly purpose: ConsentPurpose;
  readonly now?: string;
  readonly items: readonly IngestEvidenceItemInput[];
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

/**
 * 근거 수집 결과에 대해 F04 동의 검증, 시계 왜곡 방어, 보존 기한 정책을
 * 엄격히 심사한 뒤 원장에 안전하게 저장하는 함수
 */
export async function saveEvidenceBatchWithConsent(
  input: IngestEvidenceBatchInput,
  evidenceGateway: EvidenceGateway,
  consentGateway: ConsentLedgerGateway,
): Promise<readonly MarketingConnectorEvidenceRecord[]> {
  if (!input.workspaceId || typeof input.workspaceId !== 'string' || input.workspaceId.trim().length === 0) {
    throw new EvidenceValidationError('INVALID_WORKSPACE_ID', 'Invalid workspaceId');
  }

  if (!input.connectorId || typeof input.connectorId !== 'string') {
    throw new EvidenceValidationError('INVALID_CONNECTOR_ID', 'Invalid connectorId');
  }

  if (input.purpose !== 'marketing' && input.purpose !== 'booking') {
    throw new EvidenceValidationError('INVALID_PURPOSE', 'Invalid purpose: must be marketing or booking');
  }

  const effectiveNow = input.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNow)) {
    throw new EvidenceValidationError('INVALID_TIMESTAMP', 'Invalid now timestamp');
  }
  const nowEpoch = Date.parse(effectiveNow);

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return [];
  }

  const validatedRepositoryItems: SaveEvidenceItemInput[] = [];

  for (const item of input.items) {
    if (!item.sourceId || typeof item.sourceId !== 'string' || item.sourceId.trim().length === 0) {
      throw new EvidenceValidationError('INVALID_SOURCE_ID', 'Invalid sourceId');
    }

    if (!item.revision || typeof item.revision !== 'string' || item.revision.trim().length === 0) {
      throw new EvidenceValidationError('INVALID_REVISION', 'Invalid revision');
    }

    if (!isValidIsoTimestamp(item.observedAt)) {
      throw new EvidenceValidationError('INVALID_TIMESTAMP', `Invalid observedAt: ${item.observedAt}`);
    }

    const observedEpoch = Date.parse(item.observedAt);

    // 1. 시계 왜곡 방어: observedAt이 now보다 300초 초과하여 미래인 경우 거부
    if (observedEpoch - nowEpoch > SKEW_FUTURE_LIMIT_MS) {
      throw new EvidenceValidationError(
        SKEW_FUTURE_LIMIT,
        `observedAt ${item.observedAt} exceeds clock skew allowance (+300s relative to now: ${effectiveNow})`,
      );
    }

    // 2. F04 동의 검증: verifySourceAccess 호출
    const accessCheck = await verifySourceAccess(
      {
        workspaceId: input.workspaceId,
        connectorId: input.connectorId,
        sourceId: item.sourceId,
        purpose: input.purpose,
        now: effectiveNow,
      },
      consentGateway,
    );

    if (!accessCheck.ok) {
      throw new EvidenceValidationError(accessCheck.code, accessCheck.reason);
    }

    const consentGeneration = accessCheck.record.consentGeneration;

    // 3. 보존 기한 정책: 최대 30일 이내 (생략 시 observedAt + 30일 자동 설정)
    let effectiveExpiresAt = item.expiresAt;
    if (!effectiveExpiresAt) {
      effectiveExpiresAt = new Date(observedEpoch + MAX_RETENTION_MS).toISOString();
    } else {
      if (!isValidIsoTimestamp(effectiveExpiresAt)) {
        throw new EvidenceValidationError('INVALID_TIMESTAMP', `Invalid expiresAt: ${effectiveExpiresAt}`);
      }
      const expiresEpoch = Date.parse(effectiveExpiresAt);
      if (expiresEpoch - observedEpoch > MAX_RETENTION_MS + 1000) {
        throw new EvidenceValidationError(
          'RETENTION_EXCEEDED',
          `Retention period exceeds maximum 30 days (observedAt: ${item.observedAt}, expiresAt: ${effectiveExpiresAt})`,
        );
      }
    }

    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new EvidenceValidationError('INVALID_TEXT', 'Evidence text must be a non-empty string');
    }

    validatedRepositoryItems.push({
      id: item.id,
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      sourceId: item.sourceId,
      revision: item.revision,
      consentGeneration,
      observedAt: item.observedAt,
      expiresAt: effectiveExpiresAt,
      purpose: input.purpose,
      text: item.text,
      derivedFromGoogle: Boolean(item.derivedFromGoogle),
      revokedAt: null,
      metadata: item.metadata ?? {},
    });
  }

  // 4. 저장소 배치 저장 (중복 revision 멱등 처리 및 버전 히스토리 유지)
  return saveBatchToRepository(
    {
      workspaceId: input.workspaceId,
      connectorId: input.connectorId,
      purpose: input.purpose,
      now: effectiveNow,
      items: validatedRepositoryItems,
    },
    evidenceGateway,
  );
}

/**
 * EvidenceService 클래스: Gateway 및 Consent 주입 기반 서비스 객체
 */
export class EvidenceService {
  constructor(
    private readonly evidenceGateway: EvidenceGateway,
    private readonly consentGateway: ConsentLedgerGateway,
  ) {}

  async saveEvidenceBatch(
    input: IngestEvidenceBatchInput,
  ): Promise<readonly MarketingConnectorEvidenceRecord[]> {
    return saveEvidenceBatchWithConsent(input, this.evidenceGateway, this.consentGateway);
  }

  async listActiveEvidence(
    params: ListActiveEvidenceParams,
  ): Promise<readonly MarketingConnectorEvidenceRecord[]> {
    return listActiveFromRepository(params, this.evidenceGateway);
  }
}
