import type { ConnectorId } from '../catalog';

export type ConsentPurpose = 'marketing' | 'booking';
export type ConsentStatus = 'active' | 'revoked';

export interface MarketingConsentRecord {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly allowedSourceIds: readonly string[];
  readonly purpose: ConsentPurpose;
  readonly validUntil: string;
  readonly aiProcessingApproved: boolean;
  readonly status: ConsentStatus;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface ConsentLedgerGateway {
  getLatestConsent(
    workspaceId: string,
    connectorId: ConnectorId,
  ): Promise<MarketingConsentRecord | null>;
  saveConsentRecord(record: MarketingConsentRecord): Promise<void>;
  getConsentHistory?(
    workspaceId: string,
    connectorId: ConnectorId,
  ): Promise<readonly MarketingConsentRecord[]>;
}

export interface RecordConsentGrantInput {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly allowedSourceIds: readonly string[];
  readonly purpose: ConsentPurpose;
  readonly validUntil: string;
  readonly aiProcessingApproved: boolean;
  readonly actorUserId: string;
  readonly now?: string;
}

export interface VerifySourceAccessParams {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly purpose: ConsentPurpose;
  readonly now: string;
}

export type SourceAccessDenialCode =
  | 'ACCESS_DENIED'
  | 'CONSENT_REVOKED'
  | 'EXPIRED_CONSENT';

export type VerifySourceAccessResult =
  | { readonly ok: true; readonly record: MarketingConsentRecord }
  | {
      readonly ok: false;
      readonly code: SourceAccessDenialCode;
      readonly reason: string;
    };

const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

/**
 * 사장님이 새로운 자료 범위를 선택하거나 목적 동의를 갱신할 때
 * generation 번호를 단조 증가(+1)시키고 불변 원장에 기록한다.
 */
export async function recordConsentGrant(
  input: RecordConsentGrantInput,
  gateway: ConsentLedgerGateway,
): Promise<MarketingConsentRecord> {
  if (!input.workspaceId || typeof input.workspaceId !== 'string' || input.workspaceId.trim().length === 0) {
    throw new Error('Invalid workspaceId');
  }

  if (!input.connectorId || typeof input.connectorId !== 'string') {
    throw new Error('Invalid connectorId');
  }

  if (!input.actorUserId || typeof input.actorUserId !== 'string' || input.actorUserId.trim().length === 0) {
    throw new Error('Invalid actorUserId');
  }

  if (!isValidIsoTimestamp(input.validUntil)) {
    throw new Error('Invalid validUntil');
  }

  if (input.purpose !== 'marketing' && input.purpose !== 'booking') {
    throw new Error('Invalid purpose');
  }

  if (typeof input.aiProcessingApproved !== 'boolean') {
    throw new Error('Invalid aiProcessingApproved');
  }

  if (!Array.isArray(input.allowedSourceIds)) {
    throw new Error('Invalid allowedSourceIds');
  }

  const effectiveNowIso = input.now ?? new Date().toISOString();
  if (!isValidIsoTimestamp(effectiveNowIso)) {
    throw new Error('Invalid now timestamp');
  }

  const nowEpoch = Date.parse(effectiveNowIso);
  const validUntilEpoch = Date.parse(input.validUntil);

  // 최대 30일 보존 기한 정책 검증 (1초 버퍼 허용)
  if (validUntilEpoch - nowEpoch > MAX_RETENTION_MS + 1000) {
    throw new Error('Retention period exceeds maximum 30 days');
  }

  const prev = await gateway.getLatestConsent(input.workspaceId, input.connectorId);
  const nextGeneration = (prev?.consentGeneration ?? 0) + 1;

  const record: MarketingConsentRecord = Object.freeze({
    workspaceId: input.workspaceId,
    connectorId: input.connectorId,
    consentGeneration: nextGeneration,
    allowedSourceIds: Object.freeze([...input.allowedSourceIds]),
    purpose: input.purpose,
    validUntil: input.validUntil,
    aiProcessingApproved: input.aiProcessingApproved,
    status: 'active',
    updatedAt: effectiveNowIso,
    updatedBy: input.actorUserId,
  });

  await gateway.saveConsentRecord(record);
  return record;
}

/**
 * 특정 리소스가 현재 활성 세대(`active`)에 포함되어 있고, 만료되지 않았으며(`now <= validUntil`),
 * 목적이 일치하는지 fail-closed 방식으로 검증한다.
 */
export async function verifySourceAccess(
  params: VerifySourceAccessParams,
  gateway: ConsentLedgerGateway,
): Promise<VerifySourceAccessResult> {
  const latest = await gateway.getLatestConsent(params.workspaceId, params.connectorId);

  if (!latest) {
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      reason: 'No consent record found for workspace and connector',
    };
  }

  if (latest.status === 'revoked') {
    return {
      ok: false,
      code: 'CONSENT_REVOKED',
      reason: 'Consent has been revoked for this connector',
    };
  }

  const nowEpoch = Date.parse(params.now);
  const validUntilEpoch = Date.parse(latest.validUntil);

  if (Number.isNaN(nowEpoch) || Number.isNaN(validUntilEpoch) || nowEpoch > validUntilEpoch) {
    return {
      ok: false,
      code: 'EXPIRED_CONSENT',
      reason: 'Consent validUntil period has expired',
    };
  }

  if (latest.purpose !== params.purpose) {
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      reason: `Consent purpose mismatch (expected ${latest.purpose}, got ${params.purpose})`,
    };
  }

  if (!latest.aiProcessingApproved) {
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      reason: 'AI processing approval has not been granted',
    };
  }

  if (!latest.allowedSourceIds.includes(params.sourceId)) {
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      reason: `Source ID "${params.sourceId}" is not in the allowed sources scope`,
    };
  }

  return {
    ok: true,
    record: latest,
  };
}

/**
 * 동의 철회 시 즉각 `status = 'revoked'`로 전이하고 세대를 무효화한다.
 */
export async function revokeConsentScope(
  workspaceId: string,
  connectorId: ConnectorId,
  actorUserId: string,
  gateway: ConsentLedgerGateway,
  now?: string,
): Promise<MarketingConsentRecord> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('Invalid workspaceId');
  }

  if (!connectorId || typeof connectorId !== 'string') {
    throw new Error('Invalid connectorId');
  }

  if (!actorUserId || typeof actorUserId !== 'string') {
    throw new Error('Invalid actorUserId');
  }

  const effectiveNowIso = now ?? new Date().toISOString();
  const prev = await gateway.getLatestConsent(workspaceId, connectorId);
  const nextGeneration = (prev?.consentGeneration ?? 0) + 1;

  const revokedRecord: MarketingConsentRecord = Object.freeze({
    workspaceId,
    connectorId,
    consentGeneration: nextGeneration,
    allowedSourceIds: Object.freeze([]),
    purpose: prev?.purpose ?? 'marketing',
    validUntil: effectiveNowIso,
    aiProcessingApproved: false,
    status: 'revoked',
    updatedAt: effectiveNowIso,
    updatedBy: actorUserId,
  });

  await gateway.saveConsentRecord(revokedRecord);
  return revokedRecord;
}

/**
 * revokeConsentScope의 축약 별칭
 */
export const revokeConsent = revokeConsentScope;
