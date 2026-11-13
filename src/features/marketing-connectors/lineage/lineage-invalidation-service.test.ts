import { describe, it, expect } from 'vitest';
import type { MarketingConnectorEvidenceRecord } from '../evidence/evidence-repository';
import type { MarketingConsentRecord } from '../consent/consent-ledger';
import {
  validateLineageForExecution,
  LineageInvalidationService,
  EXTERNAL_PUBLISHED_REVOCATION_NOTICE,
  type LineageGateway,
  type ValidateLineageInput,
} from './lineage-invalidation-service';

function createMockLineageGateway(
  evidenceRecords: MarketingConnectorEvidenceRecord[] = [],
  consentRecords: MarketingConsentRecord[] = []
): LineageGateway {
  const evidenceMap = new Map<string, MarketingConnectorEvidenceRecord>();
  for (const ev of evidenceRecords) {
    evidenceMap.set(`${ev.workspaceId}:${ev.id}`, ev);
  }

  const consentMap = new Map<string, MarketingConsentRecord>();
  for (const cs of consentRecords) {
    consentMap.set(`${cs.workspaceId}:${cs.connectorId}`, cs);
  }

  return {
    async getEvidenceById(workspaceId: string, evidenceId: string) {
      return evidenceMap.get(`${workspaceId}:${evidenceId}`) ?? null;
    },
    async getEvidenceBatch(workspaceId: string, evidenceIds: readonly string[]) {
      return evidenceIds.map((id) => evidenceMap.get(`${workspaceId}:${id}`) ?? null);
    },
    async getLatestConsent(workspaceId: string, connectorId: any) {
      return consentMap.get(`${workspaceId}:${connectorId}`) ?? null;
    },
  };
}

describe('LineageInvalidationService (MC/K03 lineage blocking engine - ANI-2179)', () => {
  const now = '2026-11-11T12:00:00.000Z';
  const futureExpiry = '2026-11-20T00:00:00.000Z';
  const pastExpiry = '2026-11-10T00:00:00.000Z';

  const sampleConsent: MarketingConsentRecord = {
    workspaceId: 'ws-100',
    connectorId: 'google_calendar',
    consentGeneration: 2,
    allowedSourceIds: ['cal-primary'],
    purpose: 'marketing',
    validUntil: futureExpiry,
    aiProcessingApproved: true,
    status: 'active',
    updatedAt: now,
    updatedBy: 'owner-1',
  };

  const sampleEvidence1: MarketingConnectorEvidenceRecord = {
    id: 'ev-1',
    workspaceId: 'ws-100',
    connectorId: 'google_calendar',
    sourceId: 'cal-primary',
    revision: 'rev-1',
    consentGeneration: 2,
    observedAt: '2026-11-11T10:00:00.000Z',
    expiresAt: futureExpiry,
    purpose: 'marketing',
    text: '크리스마스 이벤트 일정',
    derivedFromGoogle: true,
    revokedAt: null,
    metadata: {},
  };

  const sampleEvidence2: MarketingConnectorEvidenceRecord = {
    id: 'ev-2',
    workspaceId: 'ws-100',
    connectorId: 'google_calendar',
    sourceId: 'cal-primary',
    revision: 'rev-2',
    consentGeneration: 2,
    observedAt: '2026-11-11T10:30:00.000Z',
    expiresAt: futureExpiry,
    purpose: 'marketing',
    text: '주말 특가 예약 내역',
    derivedFromGoogle: true,
    revokedAt: null,
    metadata: {},
  };

  it('passes validation when all evidence records are active and unrevoked', async () => {
    const gateway = createMockLineageGateway(
      [sampleEvidence1, sampleEvidence2],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-101',
      evidenceIds: ['ev-1', 'ev-2'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activeEvidenceCount).toBe(2);
    }
  });

  it('blocks execution when an evidence record has been revoked (revokedAt !== null)', async () => {
    const revokedEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence1,
      revokedAt: '2026-11-11T11:00:00.000Z',
    };

    const gateway = createMockLineageGateway(
      [revokedEvidence, sampleEvidence2],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-102',
      evidenceIds: ['ev-1', 'ev-2'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('ev-1');
      expect(result.invalidatedEvidenceIds).not.toContain('ev-2');
      expect(result.reason).toBeDefined();
    }
  });

  it('blocks execution when an evidence record has expired (expiresAt < now)', async () => {
    const expiredEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence1,
      expiresAt: pastExpiry,
    };

    const gateway = createMockLineageGateway(
      [expiredEvidence],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'mission-201',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toEqual(['ev-1']);
    }
  });

  it('blocks execution when evidence consentGeneration is older than the current consent generation', async () => {
    const newerConsent: MarketingConsentRecord = {
      ...sampleConsent,
      consentGeneration: 3, // Current generation bumped to 3
    };

    // sampleEvidence1 has consentGeneration: 2
    const gateway = createMockLineageGateway(
      [sampleEvidence1],
      [newerConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'proposal-301',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('ev-1');
    }
  });

  it('blocks execution when consent itself is revoked (status === revoked)', async () => {
    const revokedConsent: MarketingConsentRecord = {
      ...sampleConsent,
      status: 'revoked',
    };

    const gateway = createMockLineageGateway(
      [sampleEvidence1],
      [revokedConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-103',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('ev-1');
    }
  });

  it('blocks execution when sourceId is removed from allowedSourceIds', async () => {
    const restrictedConsent: MarketingConsentRecord = {
      ...sampleConsent,
      allowedSourceIds: ['cal-other-only'], // 'cal-primary' no longer allowed
    };

    const gateway = createMockLineageGateway(
      [sampleEvidence1],
      [restrictedConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-104',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('ev-1');
    }
  });

  it('blocks execution when evidence record does not exist in the ledger', async () => {
    const gateway = createMockLineageGateway([], [sampleConsent]);

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-105',
      evidenceIds: ['non-existent-id'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('non-existent-id');
    }
  });

  it('returns external published revocation notice when alreadyPublished: true and lineage is revoked', async () => {
    const revokedEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence1,
      revokedAt: '2026-11-11T11:00:00.000Z',
    };

    const gateway = createMockLineageGateway(
      [revokedEvidence],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'published-post-99',
      evidenceIds: ['ev-1'],
      alreadyPublished: true,
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.alreadyPublished).toBe(true);
      expect(result.reason).toContain('외부 자동 삭제 불가(사용자 직접 삭제 필요) 및 신규 정보 활용 중단');
      expect(result.notice).toBe(EXTERNAL_PUBLISHED_REVOCATION_NOTICE);
      expect(result.invalidatedEvidenceIds).toContain('ev-1');
    }
  });

  it('passes validation when alreadyPublished: true and all evidence is valid', async () => {
    const gateway = createMockLineageGateway(
      [sampleEvidence1],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'published-post-100',
      evidenceIds: ['ev-1'],
      alreadyPublished: true,
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activeEvidenceCount).toBe(1);
    }
  });

  it('handles multiple invalidations and reports all invalidated evidence IDs', async () => {
    const expiredEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence1,
      id: 'ev-expired',
      expiresAt: pastExpiry,
    };
    const revokedEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence2,
      id: 'ev-revoked',
      revokedAt: '2026-11-11T09:00:00.000Z',
    };
    const validEvidence: MarketingConnectorEvidenceRecord = {
      ...sampleEvidence1,
      id: 'ev-valid',
    };

    const gateway = createMockLineageGateway(
      [expiredEvidence, revokedEvidence, validEvidence],
      [sampleConsent]
    );

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'campaign-bundle',
      evidenceIds: ['ev-expired', 'ev-revoked', 'ev-valid', 'ev-missing'],
      now,
    };

    const result = await validateLineageForExecution(input, gateway);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.invalidatedEvidenceIds).toContain('ev-expired');
      expect(result.invalidatedEvidenceIds).toContain('ev-revoked');
      expect(result.invalidatedEvidenceIds).toContain('ev-missing');
      expect(result.invalidatedEvidenceIds).not.toContain('ev-valid');
      expect(result.invalidatedEvidenceIds.length).toBe(3);
    }
  });

  it('fails closed when input parameters are invalid', async () => {
    const gateway = createMockLineageGateway([sampleEvidence1], [sampleConsent]);

    const invalidInput = {
      workspaceId: '',
      actionId: 'action-1',
      evidenceIds: ['ev-1'],
    } as ValidateLineageInput;

    const result = await validateLineageForExecution(invalidInput, gateway);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
    }
  });

  it('fails closed when gateway throws an unexpected error', async () => {
    const throwingGateway: LineageGateway = {
      async getEvidenceById() {
        throw new Error('Database connection lost');
      },
    };

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-999',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await validateLineageForExecution(input, throwingGateway);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LINEAGE_REVOKED');
      expect(result.reason).toContain('Database connection lost');
      expect(result.invalidatedEvidenceIds).toEqual(['ev-1']);
    }
  });

  it('works via LineageInvalidationService class instance', async () => {
    const gateway = createMockLineageGateway([sampleEvidence1], [sampleConsent]);
    const service = new LineageInvalidationService(gateway);

    const input: ValidateLineageInput = {
      workspaceId: 'ws-100',
      actionId: 'draft-class-test',
      evidenceIds: ['ev-1'],
      now,
    };

    const result = await service.validateLineageForExecution(input);
    expect(result.ok).toBe(true);
  });
});
