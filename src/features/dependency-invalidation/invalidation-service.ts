/**
 * Dependency Invalidation Service (HF-57 / ANI-1407)
 * Implements canonical dependency invalidation graph across
 * Knowledge, Text Harness, Image Harness, Reference Rights, Operating Policy
 * and downstream Mission, Content Version, Creative Bundle, Approval, Schedule.
 */

import type {
  UpstreamType,
  DownstreamEntity,
  UpstreamVersionChange,
  InvalidationResult,
} from './types'

export class CrossTenantAccessDeniedError extends Error {
  readonly code = 'CROSS_TENANT_ACCESS_DENIED'
  constructor(message = 'CROSS_TENANT_ACCESS_DENIED: Cross-tenant access denied') {
    super(message.includes('CROSS_TENANT_ACCESS_DENIED') ? message : `CROSS_TENANT_ACCESS_DENIED: ${message}`)
    this.name = 'CrossTenantAccessDeniedError'
  }
}

export class DependencyInvalidationService {
  private entities = new Map<string, DownstreamEntity>()
  private activeVersions = new Map<string, Map<UpstreamType, string>>()
  private referenceRights = new Map<string, Map<string, 'APPROVED' | 'PROHIBITED' | 'UNKNOWN'>>()

  /**
   * 엔티티 등록
   */
  registerEntity(entity: DownstreamEntity): void {
    const copy: DownstreamEntity = {
      ...entity,
      isStale: entity.isStale ?? false,
    }
    this.entities.set(entity.id, copy)
  }

  /**
   * 엔티티 조회 (테넌트 격리 보장)
   */
  getEntity(workspaceId: string, entityId: string): DownstreamEntity | undefined {
    const entity = this.entities.get(entityId)
    if (!entity) return undefined
    if (entity.workspaceId !== workspaceId) {
      throw new CrossTenantAccessDeniedError(
        `Entity ${entityId} does not belong to workspace ${workspaceId}`
      )
    }
    return { ...entity }
  }

  /**
   * 활성 버전 설정
   */
  setActiveVersion(workspaceId: string, upstreamType: UpstreamType, versionId: string): void {
    let wsVersions = this.activeVersions.get(workspaceId)
    if (!wsVersions) {
      wsVersions = new Map<UpstreamType, string>()
      this.activeVersions.set(workspaceId, wsVersions)
    }
    wsVersions.set(upstreamType, versionId)
  }

  /**
   * 활성 버전 조회
   */
  getActiveVersion(workspaceId: string, upstreamType: UpstreamType): string | undefined {
    return this.activeVersions.get(workspaceId)?.get(upstreamType)
  }

  /**
   * Reference 에셋 권한 설정
   */
  setReferenceRights(
    workspaceId: string,
    assetId: string,
    status: 'APPROVED' | 'PROHIBITED' | 'UNKNOWN'
  ): void {
    let wsRights = this.referenceRights.get(workspaceId)
    if (!wsRights) {
      wsRights = new Map<string, 'APPROVED' | 'PROHIBITED' | 'UNKNOWN'>()
      this.referenceRights.set(workspaceId, wsRights)
    }
    wsRights.set(assetId, status)
  }

  /**
   * Reference 에셋 권한 조회
   */
  getReferenceRights(workspaceId: string, assetId: string): 'APPROVED' | 'PROHIBITED' | 'UNKNOWN' {
    return this.referenceRights.get(workspaceId)?.get(assetId) ?? 'UNKNOWN'
  }

  /**
   * Upstream 버전 변경 이벤트 처리 및 STALE 전파
   */
  async handleUpstreamChange(event: UpstreamVersionChange): Promise<InvalidationResult> {
    const { workspaceId, upstreamType, oldVersionId, newVersionId, isConfirmed, targetEntityId } = event

    // 테넌트 격리 검증: targetEntityId가 주어진 경우
    if (targetEntityId) {
      const target = this.entities.get(targetEntityId)
      if (target && target.workspaceId !== workspaceId) {
        throw new CrossTenantAccessDeniedError(
          `Target entity ${targetEntityId} belongs to workspace ${target.workspaceId}, not ${workspaceId}`
        )
      }
    }

    // Draft 상태의 변경은 downstream에 STALE을 전파하지 않는다.
    if (!isConfirmed) {
      return {
        affectedEntities: [],
        invalidatedApprovals: [],
        timestamp: new Date().toISOString(),
      }
    }

    // 새 Confirmed 버전이 활성화됨
    this.setActiveVersion(workspaceId, upstreamType, newVersionId)

    const affectedEntities: string[] = []
    const invalidatedApprovals: string[] = []

    for (const [id, entity] of this.entities.entries()) {
      if (entity.workspaceId !== workspaceId) continue

      // 불변식: 이미 발행 완료된 historical record는 절대 무효화하지 않고 당시 lineage를 보존한다.
      if (entity.status === 'PUBLISHED') {
        continue
      }

      let matchesUpstream = false
      const deps = entity.upstreamDependencies

      switch (upstreamType) {
        case 'business_knowledge':
          matchesUpstream = deps.businessKnowledgeVersionId === oldVersionId
          break
        case 'text_harness':
          matchesUpstream = deps.textHarnessVersionId === oldVersionId
          break
        case 'image_harness':
          matchesUpstream = deps.imageHarnessVersionId === oldVersionId
          break
        case 'operating_policy':
          matchesUpstream = deps.operatingPolicyVersionId === oldVersionId
          break
        case 'reference_set':
          matchesUpstream = true
          break
      }

      if (matchesUpstream) {
        entity.isStale = true
        entity.staleReason = `Upstream ${upstreamType} changed from ${oldVersionId} to ${newVersionId}`
        entity.updatedAt = new Date().toISOString()
        affectedEntities.push(id)

        // 이미 승인(APPROVED)된 상태였던 경우 승인 무효화
        if (entity.status === 'APPROVED') {
          entity.status = 'APPROVAL_INVALIDATED'
          invalidatedApprovals.push(id)
        }
      }
    }

    return {
      affectedEntities,
      invalidatedApprovals,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * 신규 미션 플랜 생성 (최신 Confirmed 하네스 버전 바인딩)
   */
  createMissionPlan(
    workspaceId: string,
    missionId: string
  ): {
    id: string
    boundHarnessVersions: {
      textHarnessVersionId?: string
      imageHarnessVersionId?: string
      businessKnowledgeVersionId?: string
      operatingPolicyVersionId?: string
    }
  } {
    return {
      id: missionId,
      boundHarnessVersions: {
        textHarnessVersionId: this.getActiveVersion(workspaceId, 'text_harness'),
        imageHarnessVersionId: this.getActiveVersion(workspaceId, 'image_harness'),
        businessKnowledgeVersionId: this.getActiveVersion(workspaceId, 'business_knowledge'),
        operatingPolicyVersionId: this.getActiveVersion(workspaceId, 'operating_policy'),
      },
    }
  }

  /**
   * 발행 자격 사전 평가 (Reference 권한 및 STALE 여부 확인)
   */
  evaluatePublishEligibility(
    workspaceId: string,
    entityId: string
  ): { eligible: boolean; reason?: string } {
    const entity = this.getEntity(workspaceId, entityId)
    if (!entity) {
      return { eligible: false, reason: 'ENTITY_NOT_FOUND' }
    }

    if (entity.isStale) {
      return { eligible: false, reason: 'ENTITY_IS_STALE' }
    }

    const refIds = entity.upstreamDependencies.referenceAssetIds
    if (refIds && refIds.length > 0) {
      for (const refId of refIds) {
        const rights = this.getReferenceRights(workspaceId, refId)
        if (rights !== 'APPROVED') {
          return {
            eligible: false,
            reason: `REFERENCE_RIGHTS_INVALIDATED: Asset ${refId} status is ${rights}`,
          }
        }
      }
    }

    return { eligible: true }
  }

  /**
   * 승인 무결성(TOCTOU) 검증
   */
  verifyApprovalIntegrity(
    workspaceId: string,
    entityId: string,
    fingerprintHash: string
  ): { valid: boolean; code?: string } {
    const entity = this.getEntity(workspaceId, entityId)
    if (!entity) {
      return { valid: false, code: 'ENTITY_NOT_FOUND' }
    }

    if (entity.isStale) {
      return { valid: false, code: 'APPROVAL_STALE' }
    }

    if (entity.approvalFingerprint !== fingerprintHash) {
      return { valid: false, code: 'APPROVAL_FINGERPRINT_MISMATCH' }
    }

    return { valid: true }
  }

  /**
   * 스케줄 실행 직전 사전 평가 (Preflight)
   */
  preflightScheduledExecution(
    workspaceId: string,
    entityId: string
  ): { admitted: boolean; code?: string } {
    const entity = this.getEntity(workspaceId, entityId)
    if (!entity) {
      return { admitted: false, code: 'ENTITY_NOT_FOUND' }
    }

    if (entity.isStale) {
      return { admitted: false, code: 'SCHEDULE_BLOCKED_STALE' }
    }

    return { admitted: true }
  }

  /**
   * 권위 있는 상태 조회 (Owner/Admin/Agent Same-Truth 일관성)
   */
  getAuthoritativeState(
    workspaceId: string,
    entityId: string,
    _readerRole: 'owner' | 'admin' | 'agent'
  ): DownstreamEntity {
    const entity = this.getEntity(workspaceId, entityId)
    if (!entity) {
      throw new Error(`Entity ${entityId} not found in workspace ${workspaceId}`)
    }
    return { ...entity }
  }
}
