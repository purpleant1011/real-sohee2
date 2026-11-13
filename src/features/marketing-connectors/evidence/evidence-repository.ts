import { randomUUID } from 'node:crypto';
import type { ConnectorId } from '../catalog';

export type EvidencePurpose = 'marketing' | 'booking';

export interface MarketingConnectorEvidenceRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly sourceId: string;
  readonly revision: string;
  readonly consentGeneration: number;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly purpose: EvidencePurpose;
  readonly text: string;
  readonly derivedFromGoogle: boolean;
  readonly revokedAt: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type EvidenceRecord = MarketingConnectorEvidenceRecord;

export interface EvidenceGateway {
  upsertEvidence(record: MarketingConnectorEvidenceRecord): Promise<void>;
  upsertEvidenceBatch?(records: readonly MarketingConnectorEvidenceRecord[]): Promise<void>;
  findEvidenceByRevision(
    workspaceId: string,
    connectorId: ConnectorId,
    sourceId: string,
    revision: string,
  ): Promise<MarketingConnectorEvidenceRecord | null>;
  listEvidence(params: {
    readonly workspaceId: string;
    readonly connectorId: ConnectorId;
    readonly consentGeneration?: number;
    readonly purpose?: EvidencePurpose;
    readonly sourceId?: string;
  }): Promise<readonly MarketingConnectorEvidenceRecord[]>;
  revokeEvidenceBySource?(
    workspaceId: string,
    connectorId: ConnectorId,
    sourceId: string,
    revokedAt: string,
  ): Promise<void>;
}

export interface SaveEvidenceItemInput {
  readonly id?: string;
  readonly workspaceId?: string;
  readonly connectorId?: ConnectorId;
  readonly sourceId: string;
  readonly revision: string;
  readonly consentGeneration?: number;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly purpose?: EvidencePurpose;
  readonly text: string;
  readonly derivedFromGoogle: boolean;
  readonly revokedAt?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface SaveEvidenceBatchInput {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly purpose?: EvidencePurpose;
  readonly now?: string;
  readonly items: readonly SaveEvidenceItemInput[];
}

export interface ListActiveEvidenceParams {
  readonly workspaceId: string;
  readonly connectorId: ConnectorId;
  readonly consentGeneration: number;
  readonly purpose?: EvidencePurpose;
  readonly now?: string;
}

function buildRecordKey(
  workspaceId: string,
  connectorId: string,
  sourceId: string,
  revision: string,
): string {
  return `${workspaceId}:${connectorId}:${sourceId}:${revision}`;
}

/**
 * 단위 테스트 및 로컬 에뮬레이션을 위한 인메모리 EvidenceGateway 구현체
 */
export function createInMemoryEvidenceGateway(): EvidenceGateway {
  const store = new Map<string, MarketingConnectorEvidenceRecord>();

  return {
    async upsertEvidence(record: MarketingConnectorEvidenceRecord): Promise<void> {
      const key = buildRecordKey(
        record.workspaceId,
        record.connectorId,
        record.sourceId,
        record.revision,
      );
      store.set(key, record);
    },

    async upsertEvidenceBatch(records: readonly MarketingConnectorEvidenceRecord[]): Promise<void> {
      for (const record of records) {
        const key = buildRecordKey(
          record.workspaceId,
          record.connectorId,
          record.sourceId,
          record.revision,
        );
        store.set(key, record);
      }
    },

    async findEvidenceByRevision(
      workspaceId: string,
      connectorId: ConnectorId,
      sourceId: string,
      revision: string,
    ): Promise<MarketingConnectorEvidenceRecord | null> {
      const key = buildRecordKey(workspaceId, connectorId, sourceId, revision);
      return store.get(key) ?? null;
    },

    async listEvidence(params: {
      readonly workspaceId: string;
      readonly connectorId: ConnectorId;
      readonly consentGeneration?: number;
      readonly purpose?: EvidencePurpose;
      readonly sourceId?: string;
    }): Promise<readonly MarketingConnectorEvidenceRecord[]> {
      const results: MarketingConnectorEvidenceRecord[] = [];
      for (const record of store.values()) {
        if (record.workspaceId !== params.workspaceId) continue;
        if (record.connectorId !== params.connectorId) continue;
        if (params.sourceId && record.sourceId !== params.sourceId) continue;
        if (
          params.consentGeneration !== undefined &&
          record.consentGeneration !== params.consentGeneration
        ) {
          continue;
        }
        if (params.purpose !== undefined && record.purpose !== params.purpose) {
          continue;
        }
        results.push(record);
      }
      return results;
    },

    async revokeEvidenceBySource(
      workspaceId: string,
      connectorId: ConnectorId,
      sourceId: string,
      revokedAt: string,
    ): Promise<void> {
      for (const [key, record] of store.entries()) {
        if (
          record.workspaceId === workspaceId &&
          record.connectorId === connectorId &&
          record.sourceId === sourceId
        ) {
          store.set(key, {
            ...record,
            revokedAt,
          });
        }
      }
    },
  };
}

/**
 * 단일 또는 배치 수집 결과를 안전하게 원장에 저장한다.
 * 동일 (workspaceId, connectorId, sourceId, revision)이 이미 존재할 경우 멱등 처리하여
 * 기존 레코드를 그대로 보존하고, 신규 revision은 버전 히스토리로 누적 보존한다.
 */
export async function saveEvidenceBatch(
  input: SaveEvidenceBatchInput,
  gateway: EvidenceGateway,
): Promise<readonly MarketingConnectorEvidenceRecord[]> {
  const effectiveNow = input.now ?? new Date().toISOString();
  const savedRecords: MarketingConnectorEvidenceRecord[] = [];
  const recordsToInsert: MarketingConnectorEvidenceRecord[] = [];

  for (const item of input.items) {
    const workspaceId = item.workspaceId ?? input.workspaceId;
    const connectorId = item.connectorId ?? input.connectorId;
    const purpose = item.purpose ?? input.purpose ?? 'marketing';
    const consentGeneration = item.consentGeneration ?? 1;

    // Check existing record by revision (idempotency check)
    const existing = await gateway.findEvidenceByRevision(
      workspaceId,
      connectorId,
      item.sourceId,
      item.revision,
    );

    if (existing) {
      // Idempotent: return the existing unmodified record
      savedRecords.push(existing);
      continue;
    }

    const newRecord: MarketingConnectorEvidenceRecord = Object.freeze({
      id: item.id && item.id.trim().length > 0 ? item.id : randomUUID(),
      workspaceId,
      connectorId,
      sourceId: item.sourceId,
      revision: item.revision,
      consentGeneration,
      observedAt: item.observedAt,
      expiresAt: item.expiresAt,
      purpose,
      text: item.text,
      derivedFromGoogle: Boolean(item.derivedFromGoogle),
      revokedAt: item.revokedAt ?? null,
      metadata: Object.freeze({ ...(item.metadata ?? {}) }),
      createdAt: effectiveNow,
      updatedAt: effectiveNow,
    });

    recordsToInsert.push(newRecord);
    savedRecords.push(newRecord);
  }

  if (recordsToInsert.length > 0) {
    if (typeof gateway.upsertEvidenceBatch === 'function') {
      await gateway.upsertEvidenceBatch(recordsToInsert);
    } else {
      for (const record of recordsToInsert) {
        await gateway.upsertEvidence(record);
      }
    }
  }

  return savedRecords;
}

/**
 * 유효 근거 조회:
 * 만료되지 않고(expiresAt > now), revokedAt이 null이며, 동의 세대(consentGeneration)와 일치하는 근거 목록을 반환한다.
 */
export async function listActiveEvidence(
  params: ListActiveEvidenceParams,
  gateway: EvidenceGateway,
): Promise<readonly MarketingConnectorEvidenceRecord[]> {
  const effectiveNow = params.now ?? new Date().toISOString();
  const nowEpoch = Date.parse(effectiveNow);

  const rawList = await gateway.listEvidence({
    workspaceId: params.workspaceId,
    connectorId: params.connectorId,
    consentGeneration: params.consentGeneration,
    purpose: params.purpose,
  });

  return rawList
    .filter((record) => {
      if (record.revokedAt !== null) {
        return false;
      }
      if (record.consentGeneration !== params.consentGeneration) {
        return false;
      }
      if (params.purpose && record.purpose !== params.purpose) {
        return false;
      }
      const expiresEpoch = Date.parse(record.expiresAt);
      if (Number.isNaN(expiresEpoch) || expiresEpoch <= nowEpoch) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
