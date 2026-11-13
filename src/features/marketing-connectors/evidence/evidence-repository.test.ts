import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInMemoryEvidenceGateway,
  saveEvidenceBatch,
  listActiveEvidence,
  type MarketingConnectorEvidenceRecord,
  type SaveEvidenceBatchInput,
  type EvidenceGateway,
} from './evidence-repository';

describe('Evidence Repository & Gateway (MC/K01 candidate ledger)', () => {
  let gateway: EvidenceGateway;
  const now = '2026-11-11T12:00:00.000Z';
  const expiresAt = '2026-11-25T12:00:00.000Z'; // 14 days later, well within 30 days

  beforeEach(() => {
    gateway = createInMemoryEvidenceGateway();
  });

  describe('saveEvidenceBatch', () => {
    it('saves a batch of evidence records with UUIDs generated when omitted', async () => {
      const input: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'event-001',
            revision: 'rev-v1',
            consentGeneration: 1,
            observedAt: now,
            expiresAt,
            text: 'Special winter promotional consultation',
            derivedFromGoogle: true,
            metadata: { title: 'Winter Promo', start: '2026-11-15T09:00:00Z' },
          },
          {
            sourceId: 'event-002',
            revision: 'rev-v1',
            consentGeneration: 1,
            observedAt: now,
            expiresAt,
            text: 'Hair styling slot reservation',
            derivedFromGoogle: true,
            metadata: { title: 'Hair Styling' },
          },
        ],
      };

      const saved = await saveEvidenceBatch(input, gateway);

      expect(saved).toHaveLength(2);
      expect(saved[0].id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(saved[0].sourceId).toBe('event-001');
      expect(saved[0].revision).toBe('rev-v1');
      expect(saved[0].consentGeneration).toBe(1);
      expect(saved[0].purpose).toBe('marketing');
      expect(saved[0].text).toBe('Special winter promotional consultation');
      expect(saved[0].derivedFromGoogle).toBe(true);
      expect(saved[0].revokedAt).toBeNull();
      expect(saved[0].metadata).toEqual({ title: 'Winter Promo', start: '2026-11-15T09:00:00Z' });

      expect(saved[1].id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(saved[1].sourceId).toBe('event-002');
    });

    it('idempotently handles re-collection of identical revision for the same sourceId', async () => {
      const input: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'event-001',
            revision: 'rev-alpha',
            consentGeneration: 1,
            observedAt: now,
            expiresAt,
            text: 'Original snapshot text',
            derivedFromGoogle: true,
            metadata: { v: 1 },
          },
        ],
      };

      const firstBatch = await saveEvidenceBatch(input, gateway);
      const originalId = firstBatch[0].id;

      // Re-collect with the exact same revision but slightly different text/metadata
      const reCollectInput: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'event-001',
            revision: 'rev-alpha',
            consentGeneration: 1,
            observedAt: now,
            expiresAt,
            text: 'Attempted overwrite text',
            derivedFromGoogle: true,
            metadata: { v: 2 },
          },
        ],
      };

      const secondBatch = await saveEvidenceBatch(reCollectInput, gateway);
      expect(secondBatch).toHaveLength(1);
      expect(secondBatch[0].id).toBe(originalId);
      expect(secondBatch[0].text).toBe('Original snapshot text'); // Preserved idempotently
    });

    it('preserves revision history when a new revision arrives for the same sourceId', async () => {
      const initialInput: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'event-001',
            revision: 'rev-1',
            consentGeneration: 1,
            observedAt: now,
            expiresAt,
            text: 'First version of schedule',
            derivedFromGoogle: true,
            metadata: { step: 1 },
          },
        ],
      };

      await saveEvidenceBatch(initialInput, gateway);

      // New revision comes in
      const laterObservedAt = '2026-11-11T12:05:00.000Z';
      const updatedInput: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now: laterObservedAt,
        items: [
          {
            sourceId: 'event-001',
            revision: 'rev-2',
            consentGeneration: 1,
            observedAt: laterObservedAt,
            expiresAt,
            text: 'Second updated version of schedule',
            derivedFromGoogle: true,
            metadata: { step: 2 },
          },
        ],
      };

      const updatedBatch = await saveEvidenceBatch(updatedInput, gateway);
      expect(updatedBatch).toHaveLength(1);
      expect(updatedBatch[0].revision).toBe('rev-2');

      // Both revisions should be retained in the gateway
      const rev1 = await gateway.findEvidenceByRevision('ws-100', 'google_calendar', 'event-001', 'rev-1');
      const rev2 = await gateway.findEvidenceByRevision('ws-100', 'google_calendar', 'event-001', 'rev-2');

      expect(rev1).not.toBeNull();
      expect(rev1?.text).toBe('First version of schedule');
      expect(rev2).not.toBeNull();
      expect(rev2?.text).toBe('Second updated version of schedule');
    });
  });

  describe('listActiveEvidence', () => {
    beforeEach(async () => {
      // Seed gateway with various records
      const seedBatch: SaveEvidenceBatchInput = {
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        purpose: 'marketing',
        now,
        items: [
          {
            sourceId: 'active-1',
            revision: 'r1',
            consentGeneration: 1,
            observedAt: now,
            expiresAt: '2026-11-30T00:00:00.000Z',
            text: 'Active item gen 1',
            derivedFromGoogle: true,
            metadata: {},
          },
          {
            sourceId: 'active-2',
            revision: 'r1',
            consentGeneration: 1,
            observedAt: now,
            expiresAt: '2026-11-30T00:00:00.000Z',
            text: 'Active item gen 1 - marketing',
            derivedFromGoogle: true,
            metadata: {},
          },
          {
            sourceId: 'old-gen',
            revision: 'r1',
            consentGeneration: 0,
            observedAt: now,
            expiresAt: '2026-11-30T00:00:00.000Z',
            text: 'Old generation item',
            derivedFromGoogle: true,
            metadata: {},
          },
          {
            sourceId: 'expired-1',
            revision: 'r1',
            consentGeneration: 1,
            observedAt: '2026-11-01T00:00:00.000Z',
            expiresAt: '2026-11-10T00:00:00.000Z', // already expired compared to `now`
            text: 'Expired item',
            derivedFromGoogle: true,
            metadata: {},
          },
        ],
      };

      await saveEvidenceBatch(seedBatch, gateway);

      // Add a revoked item directly
      const revokedRecord: MarketingConnectorEvidenceRecord = {
        id: 'revoked-uuid',
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        sourceId: 'revoked-1',
        revision: 'r1',
        consentGeneration: 1,
        observedAt: now,
        expiresAt: '2026-11-30T00:00:00.000Z',
        purpose: 'marketing',
        text: 'Revoked item',
        derivedFromGoogle: true,
        revokedAt: '2026-11-11T12:01:00.000Z',
        metadata: {},
      };
      await gateway.upsertEvidence(revokedRecord);
    });

    it('returns only active unexpired non-revoked records matching consentGeneration', async () => {
      const active = await listActiveEvidence(
        {
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          now,
        },
        gateway,
      );

      const sourceIds = active.map((a) => a.sourceId);
      expect(sourceIds).toContain('active-1');
      expect(sourceIds).toContain('active-2');
      expect(sourceIds).not.toContain('old-gen'); // filtered out by generation
      expect(sourceIds).not.toContain('expired-1'); // filtered out by expiresAt <= now
      expect(sourceIds).not.toContain('revoked-1'); // filtered out by revokedAt !== null
    });

    it('filters by purpose when specified', async () => {
      // Add a booking purpose record
      const bookingRecord: MarketingConnectorEvidenceRecord = {
        id: 'booking-uuid',
        workspaceId: 'ws-100',
        connectorId: 'google_calendar',
        sourceId: 'booking-1',
        revision: 'r1',
        consentGeneration: 1,
        observedAt: now,
        expiresAt: '2026-11-30T00:00:00.000Z',
        purpose: 'booking',
        text: 'Booking slot',
        derivedFromGoogle: true,
        revokedAt: null,
        metadata: {},
      };
      await gateway.upsertEvidence(bookingRecord);

      const marketingOnly = await listActiveEvidence(
        {
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          purpose: 'marketing',
          now,
        },
        gateway,
      );

      expect(marketingOnly.every((i) => i.purpose === 'marketing')).toBe(true);
      expect(marketingOnly.map((i) => i.sourceId)).not.toContain('booking-1');

      const bookingOnly = await listActiveEvidence(
        {
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          purpose: 'booking',
          now,
        },
        gateway,
      );

      expect(bookingOnly).toHaveLength(1);
      expect(bookingOnly[0].sourceId).toBe('booking-1');
    });
  });
});
