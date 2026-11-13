import { randomUUID } from 'node:crypto';
import type { ConnectorId } from '../catalog';
import type { MarketingConnectorEvidenceRecord } from '../evidence/evidence-repository';
import type { MarketingConsentRecord } from '../consent/consent-ledger';
import {
  validateLineageForExecution,
  type LineageGateway,
  type ValidateLineageInput,
  type ValidateLineageResult,
} from '../lineage/lineage-invalidation-service';

export interface AcceptOpportunityInput {
  readonly workspaceId: string;
  readonly opportunityId: string;
  readonly actorUserId: string;
  readonly now?: string;
}

export interface OpportunityRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly reasonWhyNow?: string;
  readonly reason?: string;
  readonly suggestedAction: string;
  readonly evidenceIds: readonly string[];
  readonly fingerprint?: string;
  readonly expiresAt?: string;
  readonly status?: 'pending' | 'accepted' | 'rejected' | string;
  readonly type?: string;
  readonly checklist?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface EvidenceSnapshotMetadata {
  readonly evidenceIds: readonly string[];
  readonly snapshotAt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface NewMissionInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly opportunityId: string;
  readonly actorUserId: string;
  readonly title: string;
  readonly content: string;
  readonly status: 'SOHEE_READY';
  readonly autoPublish: false;
  readonly requiresApproval: true;
  readonly evidenceSnapshot: EvidenceSnapshotMetadata;
  readonly createdAt: string;
}

export interface CreatedMissionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly opportunityId: string;
  readonly actorUserId: string;
  readonly title: string;
  readonly content: string;
  readonly status: 'SOHEE_READY';
  readonly autoPublish: false;
  readonly requiresApproval: true;
  readonly evidenceSnapshot: EvidenceSnapshotMetadata;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface MissionCreationGateway {
  getOpportunity(
    workspaceId: string,
    opportunityId: string
  ): Promise<OpportunityRecord | null> | OpportunityRecord | null;

  findMissionByOpportunityId?(
    workspaceId: string,
    opportunityId: string
  ): Promise<CreatedMissionRecord | null> | CreatedMissionRecord | null;

  createMission(
    mission: NewMissionInput
  ): Promise<CreatedMissionRecord> | CreatedMissionRecord;

  updateOpportunityStatus?(
    workspaceId: string,
    opportunityId: string,
    status: 'accepted',
    metadata?: Record<string, unknown>
  ): Promise<void> | void;

  // Lineage gateway delegate methods
  lineageGateway?: LineageGateway;
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

  // Optional custom lineage validator override
  validateLineage?(
    input: ValidateLineageInput,
    gateway: LineageGateway
  ): Promise<ValidateLineageResult>;
}

export type AcceptOpportunitySuccessResult = {
  readonly ok: true;
  readonly missionId: string;
  readonly status: 'SOHEE_READY';
  readonly isReused: boolean;
  readonly mission?: CreatedMissionRecord;
};

export type AcceptOpportunityErrorResult = {
  readonly ok: false;
  readonly code:
    | 'INVALID_INPUT'
    | 'OPPORTUNITY_NOT_FOUND'
    | 'OPPORTUNITY_LINEAGE_REVOKED'
    | 'OPPORTUNITY_EXPIRED'
    | 'OPPORTUNITY_ALREADY_REJECTED'
    | 'MISSION_CREATION_FAILED';
  readonly reason: string;
  readonly invalidatedEvidenceIds?: readonly string[];
};

export type AcceptOpportunityResult =
  | AcceptOpportunitySuccessResult
  | AcceptOpportunityErrorResult;

/**
 * 선제 마케팅 제안(Opportunity) 수락 및 마케팅 미션 멱등 생성 파이프라인 (MC/P02, ANI-2181)
 *
 * 1. 제안 조회: 미존재 시 OPPORTUNITY_NOT_FOUND
 * 2. K03 Lineage 검증: 근거 철회/만료/구세대 여부 확인, 무효 근거 시 OPPORTUNITY_LINEAGE_REVOKED
 * 3. 멱등성 검증: 동일 opportunityId로 이미 생성된 미션이 존재하면 재사용 (isReused: true)
 * 4. 신규 미션 생성: status = 'SOHEE_READY', 근거 스냅샷 메타데이터 적재
 * 5. 자동 실게시/발송 금지: autoPublish = false, requiresApproval = true (사장님 최종 승인 게이트 보존)
 */
export async function acceptOpportunityAndCreateMission(
  input: AcceptOpportunityInput,
  gateway: MissionCreationGateway
): Promise<AcceptOpportunityResult> {
  // Fail-closed input validation
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.workspaceId !== 'string' ||
    input.workspaceId.trim() === '' ||
    typeof input.opportunityId !== 'string' ||
    input.opportunityId.trim() === '' ||
    typeof input.actorUserId !== 'string' ||
    input.actorUserId.trim() === ''
  ) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: '유효하지 않은 요청 파라미터입니다.',
    };
  }

  const now = input.now ?? new Date().toISOString();

  try {
    // 1단계: 제안 및 연관 근거 조회
    const opportunity = await gateway.getOpportunity(input.workspaceId, input.opportunityId);
    if (!opportunity) {
      return {
        ok: false,
        code: 'OPPORTUNITY_NOT_FOUND',
        reason: `제안(${input.opportunityId})을 찾을 수 없습니다.`,
      };
    }

    if (opportunity.status === 'rejected') {
      return {
        ok: false,
        code: 'OPPORTUNITY_ALREADY_REJECTED',
        reason: '이미 거절된 제안은 수락할 수 없습니다.',
      };
    }

    if (opportunity.expiresAt && opportunity.expiresAt < now) {
      return {
        ok: false,
        code: 'OPPORTUNITY_EXPIRED',
        reason: '제안 유효 기한이 만료되었습니다.',
      };
    }

    // 2단계: K03 validateLineageForExecution 연동으로 근거 유효성 검증
    const evidenceIds = Array.isArray(opportunity.evidenceIds) ? opportunity.evidenceIds : [];
    const lineageGateway: LineageGateway = gateway.lineageGateway ?? {
      getEvidenceById: gateway.getEvidenceById ? gateway.getEvidenceById.bind(gateway) : undefined,
      getEvidenceBatch: gateway.getEvidenceBatch ? gateway.getEvidenceBatch.bind(gateway) : undefined,
      getLatestConsent: gateway.getLatestConsent ? gateway.getLatestConsent.bind(gateway) : undefined,
    };

    const lineageValidator = gateway.validateLineage ?? validateLineageForExecution;
    const lineageResult = await lineageValidator(
      {
        workspaceId: input.workspaceId,
        actionId: input.opportunityId,
        evidenceIds,
        now,
        actionType: 'mission',
      },
      lineageGateway
    );

    if (!lineageResult.ok) {
      return {
        ok: false,
        code: 'OPPORTUNITY_LINEAGE_REVOKED',
        reason: lineageResult.reason || '근거 자료가 철회되었거나 유효하지 않아 실행이 차단되었습니다.',
        invalidatedEvidenceIds: lineageResult.invalidatedEvidenceIds,
      };
    }

    // 3단계: 멱등성 검증 - 이미 해당 opportunityId로 생성된 미션이 존재하면 기존 미션 반환
    if (typeof gateway.findMissionByOpportunityId === 'function') {
      const existingMission = await gateway.findMissionByOpportunityId(
        input.workspaceId,
        input.opportunityId
      );
      if (existingMission) {
        return {
          ok: true,
          missionId: existingMission.id,
          status: 'SOHEE_READY',
          isReused: true,
          mission: existingMission,
        };
      }
    }

    // 4단계 & 5단계: 신규 미션 생성 (status = 'SOHEE_READY', 자동 실게시 금지)
    const missionId = `msn-opp-${randomUUID()}`;
    const newMissionPayload: NewMissionInput = {
      id: missionId,
      workspaceId: input.workspaceId,
      opportunityId: input.opportunityId,
      actorUserId: input.actorUserId,
      title: opportunity.title,
      content:
        opportunity.suggestedAction ||
        opportunity.reasonWhyNow ||
        opportunity.reason ||
        '',
      status: 'SOHEE_READY',
      autoPublish: false,
      requiresApproval: true,
      evidenceSnapshot: {
        evidenceIds,
        snapshotAt: now,
        metadata: opportunity.metadata,
      },
      createdAt: now,
    };

    const createdMission = await gateway.createMission(newMissionPayload);

    if (!createdMission || !createdMission.id) {
      return {
        ok: false,
        code: 'MISSION_CREATION_FAILED',
        reason: '미션 레코드 생성에 실패했습니다.',
      };
    }

    // 제안 상태를 accepted로 전이
    if (typeof gateway.updateOpportunityStatus === 'function') {
      await gateway.updateOpportunityStatus(input.workspaceId, input.opportunityId, 'accepted', {
        missionId: createdMission.id,
        acceptedBy: input.actorUserId,
        acceptedAt: now,
      });
    }

    return {
      ok: true,
      missionId: createdMission.id,
      status: 'SOHEE_READY',
      isReused: false,
      mission: createdMission,
    };
  } catch (error) {
    // Fail-Closed: 예상치 못한 오류 발생 시 안전하게 차단
    return {
      ok: false,
      code: 'MISSION_CREATION_FAILED',
      reason: `미션 생성 중 예외 발생: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
