import { describe, it, expect, vi } from 'vitest';
import {
  acceptOpportunityAndCreateMission,
  type AcceptOpportunityInput,
  type MissionCreationGateway,
  type OpportunityRecord,
  type CreatedMissionRecord,
} from './opportunity-acceptance-service';
import type { MarketingConnectorEvidenceRecord } from '../evidence/evidence-repository';
import type { MarketingConsentRecord } from '../consent/consent-ledger';

describe('ANI-2181: MC/P02 제안 수락→기존 마케팅 미션 멱등 생성·승인 파이프라인', () => {
  const workspaceId = 'ws-test-123';
  const opportunityId = 'opp-test-456';
  const actorUserId = 'user-owner-789';
  const now = '2026-11-11T12:00:00.000Z';
  const futureDate = '2026-11-20T12:00:00.000Z';

  const mockEvidence: MarketingConnectorEvidenceRecord = {
    id: 'evi-1',
    workspaceId,
    connectorId: 'google_calendar',
    sourceId: 'cal-main',
    revision: 'rev-1',
    purpose: 'marketing',
    text: '봄맞이 플리마켓 행사',
    derivedFromGoogle: true,
    consentGeneration: 1,
    observedAt: '2026-11-10T10:00:00.000Z',
    expiresAt: futureDate,
    revokedAt: null,
    metadata: { eventId: 'evt-100', start: futureDate },
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };

  const mockConsent: MarketingConsentRecord = {
    workspaceId,
    connectorId: 'google_calendar',
    status: 'active',
    consentGeneration: 1,
    allowedSourceIds: ['cal-main'],
    purpose: 'marketing',
    aiProcessingApproved: true,
    validUntil: futureDate,
    updatedAt: '2026-11-01T00:00:00.000Z',
    updatedBy: actorUserId,
  };

  const mockOpportunity: OpportunityRecord = {
    id: opportunityId,
    workspaceId,
    title: '[이벤트 사전 홍보] 봄맞이 플리마켓 일정 사전 안내',
    reasonWhyNow: '행사 D-9일 전으로 사전 홍보에 가장 적절한 시점입니다.',
    suggestedAction: '인스타그램 피드 및 네이버 플레이스 소식에 행사 일정 공지 등록',
    evidenceIds: ['evi-1'],
    status: 'pending',
    expiresAt: futureDate,
    metadata: { source: 'calendar' },
  };

  function createMockGateway(overrides: Partial<MissionCreationGateway> = {}): MissionCreationGateway {
    return {
      getOpportunity: vi.fn().mockResolvedValue(mockOpportunity),
      getEvidenceBatch: vi.fn().mockResolvedValue([mockEvidence]),
      getLatestConsent: vi.fn().mockResolvedValue(mockConsent),
      findMissionByOpportunityId: vi.fn().mockResolvedValue(null),
      createMission: vi.fn().mockImplementation((newMission) =>
        Promise.resolve({
          ...newMission,
          id: 'msn-created-999',
          createdAt: now,
          updatedAt: now,
        })
      ),
      updateOpportunityStatus: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  describe('1단계: 입력값 및 제안 조회 검증', () => {
    it('입력값이 유효하지 않으면 INVALID_INPUT 에러를 반환한다', async () => {
      const gateway = createMockGateway();
      const result = await acceptOpportunityAndCreateMission(
        { workspaceId: '', opportunityId: '', actorUserId: '' } as AcceptOpportunityInput,
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_INPUT');
      }
    });

    it('제안(Opportunity)이 존재하지 않으면 OPPORTUNITY_NOT_FOUND 에러를 반환한다', async () => {
      const gateway = createMockGateway({
        getOpportunity: vi.fn().mockResolvedValue(null),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_NOT_FOUND');
      }
    });

    it('이미 거절된(rejected) 제안인 경우 수락을 거부한다', async () => {
      const gateway = createMockGateway({
        getOpportunity: vi.fn().mockResolvedValue({
          ...mockOpportunity,
          status: 'rejected',
        }),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_ALREADY_REJECTED');
      }
    });

    it('이미 기한이 만료된 제안인 경우 수락을 거부한다', async () => {
      const gateway = createMockGateway({
        getOpportunity: vi.fn().mockResolvedValue({
          ...mockOpportunity,
          expiresAt: '2026-11-01T00:00:00.000Z', // past
        }),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_EXPIRED');
      }
    });
  });

  describe('2단계: K03 Lineage 검증 (근거 유효성/철회/만료)', () => {
    it('근거가 철회(revokedAt !== null)된 경우 OPPORTUNITY_LINEAGE_REVOKED로 거부한다', async () => {
      const gateway = createMockGateway({
        getEvidenceBatch: vi.fn().mockResolvedValue([
          {
            ...mockEvidence,
            revokedAt: '2026-11-10T15:00:00.000Z',
          },
        ]),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_LINEAGE_REVOKED');
        expect(result.invalidatedEvidenceIds).toContain('evi-1');
      }
      expect(gateway.createMission).not.toHaveBeenCalled();
    });

    it('동의가 철회되었거나 유효하지 않은 경우 OPPORTUNITY_LINEAGE_REVOKED로 거부한다', async () => {
      const gateway = createMockGateway({
        getLatestConsent: vi.fn().mockResolvedValue({
          ...mockConsent,
          status: 'revoked',
        }),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_LINEAGE_REVOKED');
      }
      expect(gateway.createMission).not.toHaveBeenCalled();
    });

    it('근거 데이터 자체가 원장에 존재하지 않는 경우 OPPORTUNITY_LINEAGE_REVOKED로 거부한다', async () => {
      const gateway = createMockGateway({
        getEvidenceBatch: vi.fn().mockResolvedValue([null]),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('OPPORTUNITY_LINEAGE_REVOKED');
      }
      expect(gateway.createMission).not.toHaveBeenCalled();
    });
  });

  describe('3단계: 멱등성 검증 (Idempotency)', () => {
    it('이미 해당 opportunityId로 생성된 미션이 존재하면 신규 생성 없이 기존 미션을 반환한다 (isReused: true)', async () => {
      const existingMission: CreatedMissionRecord = {
        id: 'msn-existing-123',
        workspaceId,
        opportunityId,
        actorUserId,
        title: mockOpportunity.title,
        content: mockOpportunity.suggestedAction,
        status: 'SOHEE_READY',
        autoPublish: false,
        requiresApproval: true,
        evidenceSnapshot: {
          evidenceIds: ['evi-1'],
          snapshotAt: '2026-11-10T12:00:00.000Z',
        },
        createdAt: '2026-11-10T12:00:00.000Z',
      };

      const gateway = createMockGateway({
        findMissionByOpportunityId: vi.fn().mockResolvedValue(existingMission),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isReused).toBe(true);
        expect(result.missionId).toBe('msn-existing-123');
        expect(result.status).toBe('SOHEE_READY');
      }
      expect(gateway.createMission).not.toHaveBeenCalled();
    });
  });

  describe('4단계 & 5단계: 신규 미션 생성 및 승인 게이트 보존', () => {
    it('성공적으로 SOHEE_READY 미션을 생성하고 제안 상태를 accepted로 전이한다 (isReused: false)', async () => {
      const gateway = createMockGateway();

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isReused).toBe(false);
        expect(result.status).toBe('SOHEE_READY');
        expect(result.missionId).toBe('msn-created-999');
      }

      // 4단계: 신규 미션 생성 파라미터 검증
      expect(gateway.createMission).toHaveBeenCalledTimes(1);
      const createdMissionArg = vi.mocked(gateway.createMission).mock.calls[0][0];
      expect(createdMissionArg.workspaceId).toBe(workspaceId);
      expect(createdMissionArg.opportunityId).toBe(opportunityId);
      expect(createdMissionArg.actorUserId).toBe(actorUserId);
      expect(createdMissionArg.status).toBe('SOHEE_READY');
      expect(createdMissionArg.title).toBe(mockOpportunity.title);
      expect(createdMissionArg.content).toBe(mockOpportunity.suggestedAction);
      expect(createdMissionArg.evidenceSnapshot.evidenceIds).toEqual(['evi-1']);
      expect(createdMissionArg.evidenceSnapshot.snapshotAt).toBe(now);

      // 5단계: 자동 실게시/발송 금지 (승인 게이트 보존)
      expect(createdMissionArg.autoPublish).toBe(false);
      expect(createdMissionArg.requiresApproval).toBe(true);

      // 제안 상태 전이 확인
      expect(gateway.updateOpportunityStatus).toHaveBeenCalledWith(
        workspaceId,
        opportunityId,
        'accepted',
        expect.objectContaining({
          missionId: 'msn-created-999',
          acceptedBy: actorUserId,
        })
      );
    });

    it('미션 생성 실패 시 안전하게 실패를 반환하고 임시 ID 등으로 성공을 위장하지 않는다', async () => {
      const gateway = createMockGateway({
        createMission: vi.fn().mockRejectedValue(new Error('DB Connection Timeout')),
      });

      const result = await acceptOpportunityAndCreateMission(
        { workspaceId, opportunityId, actorUserId, now },
        gateway
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('MISSION_CREATION_FAILED');
        expect(result.reason).toContain('DB Connection Timeout');
      }
    });
  });
});
