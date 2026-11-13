import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceService,
  EvidenceValidationError,
  SKEW_FUTURE_LIMIT,
  saveEvidenceBatchWithConsent,
} from './evidence-service';
import {
  createInMemoryEvidenceGateway,
  type EvidenceGateway,
} from './evidence-repository';
import type {
  ConsentLedgerGateway,
  MarketingConsentRecord,
} from '../consent/consent-ledger';

function createMockConsentGateway(initialRecords: MarketingConsentRecord[] = []): ConsentLedgerGateway {
  const records = new Map<string, MarketingConsentRecord>();
  for (const r of initialRecords) {
    records.set(`${r.workspaceId}:${r.connectorId}`, r);
  }

  return {
    async getLatestConsent(workspaceId: string, connectorId: string) {
      return records.get(`${workspaceId}:${connectorId}`) ?? null;
    },
    async saveConsentRecord(record: MarketingConsentRecord) {
      records.set(`${record.workspaceId}:${record.connectorId}`, record);
    },
  };
}

describe('Evidence Service (F04 consent verification & clock-skew enforcement)', () => {
  let evidenceGateway: EvidenceGateway;
  let consentGateway: ConsentLedgerGateway;
  const now = '2026-11-11T12:00:00.000Z';
  const futureWithinSkew = '2026-11-11T12:04:30.000Z'; // +270s (within 300s)
  const futureExceedingSkew = '2026-11-11T12:05:01.000Z'; // +301s (exceeds 300s)

  beforeEach(() => {
    evidenceGateway = createInMemoryEvidenceGateway();
    consentGateway = createMockConsentGateway([
      {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        consentGeneration: 2,
        allowedSourceIds: ['cal-primary', 'cal-team'],
        purpose: 'marketing',
        validUntil: '2026-11-30T00:00:00.000Z',
        aiProcessingApproved: true,
        status: 'active',
        updatedAt: now,
        updatedBy: 'owner-1',
      },
    ]);
  });

  describe('F04 Consent Verification', () => {
    it('successfully stores evidence when consent is active and source is allowed', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      const result = await service.saveEvidenceBatch({
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'cal-primary',
            revision: 'rev-101',
            observedAt: now,
            text: 'Hair shop weekend sale event',
            derivedFromGoogle: true,
            metadata: { summary: 'Weekend Sale' },
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].consentGeneration).toBe(2);
      expect(result[0].sourceId).toBe('cal-primary');
    });

    it('rejects with EvidenceValidationError (ACCESS_DENIED) when no consent record exists', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-other',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-1',
              observedAt: now,
              text: 'Unauthorized source item',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toThrow(EvidenceValidationError);

      try {
        await service.saveEvidenceBatch({
          workspaceId: 'ws-other',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-1',
              observedAt: now,
              text: 'Unauthorized source item',
              derivedFromGoogle: true,
            },
          ],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(EvidenceValidationError);
        expect((err as EvidenceValidationError).code).toBe('ACCESS_DENIED');
      }
    });

    it('rejects with EvidenceValidationError (CONSENT_REVOKED) when consent is revoked', async () => {
      await consentGateway.saveConsentRecord({
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        consentGeneration: 3,
        allowedSourceIds: [],
        purpose: 'marketing',
        validUntil: now,
        aiProcessingApproved: false,
        status: 'revoked',
        updatedAt: now,
        updatedBy: 'owner-1',
      });

      const service = new EvidenceService(evidenceGateway, consentGateway);

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-1',
              observedAt: now,
              text: 'Revoked source item',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'CONSENT_REVOKED',
      });
    });

    it('rejects with EvidenceValidationError (EXPIRED_CONSENT) when consent has expired', async () => {
      await consentGateway.saveConsentRecord({
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        consentGeneration: 2,
        allowedSourceIds: ['cal-primary'],
        purpose: 'marketing',
        validUntil: '2026-11-10T00:00:00.000Z', // In the past relative to `now`
        aiProcessingApproved: true,
        status: 'active',
        updatedAt: '2026-11-01T00:00:00.000Z',
        updatedBy: 'owner-1',
      });

      const service = new EvidenceService(evidenceGateway, consentGateway);

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-1',
              observedAt: now,
              text: 'Expired item',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'EXPIRED_CONSENT',
      });
    });

    it('rejects with EvidenceValidationError (ACCESS_DENIED) when sourceId is not allowed in scope', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-unauthorized-private',
              revision: 'rev-1',
              observedAt: now,
              text: 'Private calendar data',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
      });
    });
  });

  describe('Clock Skew Defense (SKEW_FUTURE_LIMIT)', () => {
    it('accepts observedAt up to +300 seconds in the future', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      const result = await service.saveEvidenceBatch({
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'cal-primary',
            revision: 'rev-skew-ok',
            observedAt: futureWithinSkew,
            text: 'Valid within 300s skew',
            derivedFromGoogle: true,
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].revision).toBe('rev-skew-ok');
    });

    it('rejects observedAt exceeding +300 seconds in the future with SKEW_FUTURE_LIMIT', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-future-bad',
              observedAt: futureExceedingSkew,
              text: 'Time-traveling data',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toMatchObject({
        name: 'EvidenceValidationError',
        code: SKEW_FUTURE_LIMIT,
      });
    });
  });

  describe('Retention Period Check (max 30 days)', () => {
    it('automatically defaults expiresAt to observedAt + 30 days when omitted', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);

      const [item] = await service.saveEvidenceBatch({
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'cal-primary',
            revision: 'rev-auto-expire',
            observedAt: now,
            text: 'Auto expiration test',
            derivedFromGoogle: true,
          },
        ],
      });

      const observedMs = Date.parse(now);
      const expiresMs = Date.parse(item.expiresAt);
      expect(expiresMs - observedMs).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('rejects explicit expiresAt exceeding 30 days from observedAt', async () => {
      const service = new EvidenceService(evidenceGateway, consentGateway);
      const wayTooFar = '2026-12-30T00:00:00.000Z'; // > 45 days

      await expect(
        service.saveEvidenceBatch({
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-long-retention',
              observedAt: now,
              expiresAt: wayTooFar,
              text: 'Too long retention',
              derivedFromGoogle: true,
            },
          ],
        }),
      ).rejects.toMatchObject({
        name: 'EvidenceValidationError',
        code: 'RETENTION_EXCEEDED',
      });
    });
  });

  describe('Functional API helper saveEvidenceBatchWithConsent', () => {
    it('works as a standalone function passing consentGateway', async () => {
      const result = await saveEvidenceBatchWithConsent(
        {
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          purpose: 'marketing',
          now,
          items: [
            {
              sourceId: 'cal-primary',
              revision: 'rev-func-1',
              observedAt: now,
              text: 'Standalone helper save',
              derivedFromGoogle: true,
            },
          ],
        },
        evidenceGateway,
        consentGateway,
      );

      expect(result).toHaveLength(1);
      expect(result[0].revision).toBe('rev-func-1');
    });
  });
});
