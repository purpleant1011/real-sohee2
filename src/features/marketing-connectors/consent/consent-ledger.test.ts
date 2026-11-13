import { describe, expect, it } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  type ConsentLedgerGateway,
  type MarketingConsentRecord,
  recordConsentGrant,
  revokeConsent,
  revokeConsentScope,
  verifySourceAccess,
} from './consent-ledger';

class InMemoryConsentLedgerGateway implements ConsentLedgerGateway {
  private readonly records: MarketingConsentRecord[] = [];

  async getLatestConsent(
    workspaceId: string,
    connectorId: ConnectorId,
  ): Promise<MarketingConsentRecord | null> {
    const matching = this.records
      .filter((r) => r.workspaceId === workspaceId && r.connectorId === connectorId)
      .sort((a, b) => b.consentGeneration - a.consentGeneration);
    return matching[0] ?? null;
  }

  async saveConsentRecord(record: MarketingConsentRecord): Promise<void> {
    this.records.push(record);
  }

  getAllRecords(): readonly MarketingConsentRecord[] {
    return Object.freeze([...this.records]);
  }
}

describe('consent-ledger (ANI-2151 / F04)', () => {
  const workspaceId = 'ws_test_company_001';
  const connectorId: ConnectorId = 'google_calendar';
  const actorUserId = 'usr_owner_42';
  const nowIso = '2026-11-11T12:00:00.000Z';
  const validUntilIso = '2026-12-01T12:00:00.000Z'; // 20 days later (within 30 days)

  describe('recordConsentGrant', () => {
    it('초기 동의 부여 시 generation 1로 불변 원장에 active 상태로 기록된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();

      const record = await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main', 'cal_marketing'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      expect(record).toEqual({
        workspaceId,
        connectorId,
        consentGeneration: 1,
        allowedSourceIds: ['cal_main', 'cal_marketing'],
        purpose: 'marketing',
        validUntil: validUntilIso,
        aiProcessingApproved: true,
        status: 'active',
        updatedAt: nowIso,
        updatedBy: actorUserId,
      });

      const latest = await gateway.getLatestConsent(workspaceId, connectorId);
      expect(latest).toEqual(record);
    });

    it('동의 범위를 수정/갱신하면 generation 번호가 단조 증가(+1)하고 새 레코드가 불변 추가된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();

      // Generation 1
      const grant1 = await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );
      expect(grant1.consentGeneration).toBe(1);

      // Generation 2: 범위 추가
      const laterNow = '2026-11-12T09:00:00.000Z';
      const grant2 = await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main', 'cal_secondary'],
          purpose: 'marketing',
          validUntil: '2026-12-10T09:00:00.000Z',
          aiProcessingApproved: true,
          actorUserId,
          now: laterNow,
        },
        gateway,
      );
      expect(grant2.consentGeneration).toBe(2);
      expect(grant2.allowedSourceIds).toEqual(['cal_main', 'cal_secondary']);

      // 원장에는 2개의 레코드가 보존되어야 함 (불변 원장)
      const all = gateway.getAllRecords();
      expect(all).toHaveLength(2);
      expect(all[0].consentGeneration).toBe(1);
      expect(all[1].consentGeneration).toBe(2);
    });

    it('필수 입력값 누락이나 잘못된 날짜 형식은 거부된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();

      await expect(
        recordConsentGrant(
          {
            workspaceId: '',
            connectorId,
            allowedSourceIds: ['cal_main'],
            purpose: 'marketing',
            validUntil: validUntilIso,
            aiProcessingApproved: true,
            actorUserId,
          },
          gateway,
        ),
      ).rejects.toThrow('Invalid workspaceId');

      await expect(
        recordConsentGrant(
          {
            workspaceId,
            connectorId,
            allowedSourceIds: ['cal_main'],
            purpose: 'marketing',
            validUntil: 'invalid-date',
            aiProcessingApproved: true,
            actorUserId,
          },
          gateway,
        ),
      ).rejects.toThrow('Invalid validUntil');
    });

    it('보존 기한이 최대 30일을 초과하면 거부된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      const tooFarDate = '2027-01-01T00:00:00.000Z'; // > 50 days later

      await expect(
        recordConsentGrant(
          {
            workspaceId,
            connectorId,
            allowedSourceIds: ['cal_main'],
            purpose: 'marketing',
            validUntil: tooFarDate,
            aiProcessingApproved: true,
            actorUserId,
            now: nowIso,
          },
          gateway,
        ),
      ).rejects.toThrow('Retention period exceeds maximum 30 days');
    });
  });

  describe('verifySourceAccess', () => {
    it('활성 동의, 유효 기간 내, 목적 일치, AI 처리 승인, 허용된 소스 ID인 경우 정상 승인된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main', 'cal_marketing'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'marketing',
          now: '2026-11-15T10:00:00.000Z',
        },
        gateway,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.record.consentGeneration).toBe(1);
        expect(result.record.status).toBe('active');
      }
    });

    it('동의 기록이 전혀 없는 경우 ACCESS_DENIED로 즉각 차단된다 (fail-closed)', async () => {
      const gateway = new InMemoryConsentLedgerGateway();

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'marketing',
          now: nowIso,
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('선택된 허용 리소스 목록에 없는 sourceId는 ACCESS_DENIED로 차단된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_unauthorized',
          purpose: 'marketing',
          now: nowIso,
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('목적이 일치하지 않는 경우 ACCESS_DENIED로 차단된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'booking',
          now: nowIso,
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('AI 처리 동의(aiProcessingApproved)가 false인 경우 ACCESS_DENIED로 차단된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: false,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'marketing',
          now: nowIso,
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('validUntil 만료 시 EXPIRED_CONSENT로 차단된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso, // 2026-12-01T12:00:00.000Z
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'marketing',
          now: '2026-12-02T00:00:00.000Z', // Past validUntil
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('EXPIRED_CONSENT');
      }
    });

    it('동의가 철회된 상태이면 CONSENT_REVOKED로 차단된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      await revokeConsentScope(workspaceId, connectorId, actorUserId, gateway);

      const result = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_main',
          purpose: 'marketing',
          now: nowIso,
        },
        gateway,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONSENT_REVOKED');
      }
    });
  });

  describe('revokeConsentScope 및 revokeConsent', () => {
    it('동의 철회 시 새 generation 번호로 status: revoked 레코드가 원장에 기록된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const revokeTime = '2026-11-15T08:00:00.000Z';
      const revokedRecord = await revokeConsentScope(
        workspaceId,
        connectorId,
        actorUserId,
        gateway,
        revokeTime,
      );

      expect(revokedRecord.status).toBe('revoked');
      expect(revokedRecord.consentGeneration).toBe(2);
      expect(revokedRecord.allowedSourceIds).toEqual([]);
      expect(revokedRecord.aiProcessingApproved).toBe(false);
      expect(revokedRecord.updatedAt).toBe(revokeTime);
      expect(revokedRecord.updatedBy).toBe(actorUserId);

      // 최신 상태 확인
      const latest = await gateway.getLatestConsent(workspaceId, connectorId);
      expect(latest?.status).toBe('revoked');
      expect(latest?.consentGeneration).toBe(2);
    });

    it('revokeConsent 별칭 함수도 동일하게 동작한다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      const revokedRecord = await revokeConsent(
        workspaceId,
        connectorId,
        actorUserId,
        gateway,
      );

      expect(revokedRecord.status).toBe('revoked');
      expect(revokedRecord.consentGeneration).toBe(2);
    });

    it('동의 기록이 전혀 없던 커넥터를 철회 호출 시에도 generation 1의 revoked 레코드가 기록된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      const revoked = await revokeConsentScope(
        workspaceId,
        connectorId,
        actorUserId,
        gateway,
        nowIso,
      );

      expect(revoked.consentGeneration).toBe(1);
      expect(revoked.status).toBe('revoked');
      expect(revoked.allowedSourceIds).toEqual([]);
    });

    it('철회 후 다시 동의를 부여하면 세대가 증가하며 다시 active 상태가 된다', async () => {
      const gateway = new InMemoryConsentLedgerGateway();
      // Gen 1: Grant
      await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main'],
          purpose: 'marketing',
          validUntil: validUntilIso,
          aiProcessingApproved: true,
          actorUserId,
          now: nowIso,
        },
        gateway,
      );

      // Gen 2: Revoke
      await revokeConsentScope(workspaceId, connectorId, actorUserId, gateway, '2026-11-12T00:00:00.000Z');

      // Gen 3: Re-grant
      const reGranted = await recordConsentGrant(
        {
          workspaceId,
          connectorId,
          allowedSourceIds: ['cal_main', 'cal_new'],
          purpose: 'marketing',
          validUntil: '2026-12-05T00:00:00.000Z',
          aiProcessingApproved: true,
          actorUserId,
          now: '2026-11-13T00:00:00.000Z',
        },
        gateway,
      );

      expect(reGranted.consentGeneration).toBe(3);
      expect(reGranted.status).toBe('active');

      const check = await verifySourceAccess(
        {
          workspaceId,
          connectorId,
          sourceId: 'cal_new',
          purpose: 'marketing',
          now: '2026-11-14T00:00:00.000Z',
        },
        gateway,
      );
      expect(check.ok).toBe(true);
    });
  });
});
