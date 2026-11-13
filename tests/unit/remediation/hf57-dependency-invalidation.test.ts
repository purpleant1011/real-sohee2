import { describe, it, expect, beforeEach } from 'vitest'
import {
  DependencyInvalidationService,
  type UpstreamVersionChange,
  type DownstreamEntity,
} from '@/features/dependency-invalidation'

describe('HF-57 / ANI-1407 · Knowledge & Harness Dependency Invalidation Engine', () => {
  const WORKSPACE_ID = 'ws-test-dependency-1'
  const OTHER_WORKSPACE_ID = 'ws-test-dependency-2'

  let service: DependencyInvalidationService

  beforeEach(() => {
    service = new DependencyInvalidationService()
  })

  // Test 1: 새 Knowledge Draft만 생성 -> 기존 active content 영향 없음
  it('1. ignores draft creation and keeps active pending content intact', async () => {
    const content: DownstreamEntity = {
      id: 'cnt-1',
      workspaceId: WORKSPACE_ID,
      type: 'content_version',
      status: 'DRAFT',
      upstreamDependencies: {
        businessKnowledgeVersionId: 'bk-v1',
        textHarnessVersionId: 'th-v1',
        imageHarnessVersionId: 'ih-v1',
        operatingPolicyVersionId: 'op-v1',
      },
    }
    service.registerEntity(content)

    // Draft 생성 이벤트 (isConfirmed: false)
    const event: UpstreamVersionChange = {
      workspaceId: WORKSPACE_ID,
      upstreamType: 'business_knowledge',
      oldVersionId: 'bk-v1',
      newVersionId: 'bk-v2-draft',
      isConfirmed: false,
    }

    const result = await service.handleUpstreamChange(event)
    expect(result.affectedEntities).toHaveLength(0)

    const updated = service.getEntity(WORKSPACE_ID, 'cnt-1')
    expect(updated?.status).toBe('DRAFT')
    expect(updated?.isStale).toBe(false)
  })

  // Test 2: 새 Knowledge Confirmed activation -> affected pending content STALE
  it('2. propagates STALE to affected pending content when Knowledge is confirmed', async () => {
    const pendingContent: DownstreamEntity = {
      id: 'cnt-2',
      workspaceId: WORKSPACE_ID,
      type: 'content_version',
      status: 'PENDING_APPROVAL',
      upstreamDependencies: {
        businessKnowledgeVersionId: 'bk-v1',
      },
    }
    service.registerEntity(pendingContent)

    // 새 Confirmed 버전 활성화
    const event: UpstreamVersionChange = {
      workspaceId: WORKSPACE_ID,
      upstreamType: 'business_knowledge',
      oldVersionId: 'bk-v1',
      newVersionId: 'bk-v2',
      isConfirmed: true,
    }

    const result = await service.handleUpstreamChange(event)
    expect(result.affectedEntities).toContain('cnt-2')

    const updated = service.getEntity(WORKSPACE_ID, 'cnt-2')
    expect(updated?.isStale).toBe(true)
    expect(updated?.staleReason).toContain('Upstream business_knowledge changed from bk-v1 to bk-v2')
  })

  // Test 3: Text Harness Draft 생성 -> 기존 active 유지
  it('3. keeps active Text Harness and downstream intact on Text Draft creation', async () => {
    const bundle: DownstreamEntity = {
      id: 'bnd-1',
      workspaceId: WORKSPACE_ID,
      type: 'creative_bundle',
      status: 'PENDING_APPROVAL',
      upstreamDependencies: {
        textHarnessVersionId: 'th-v1',
      },
    }
    service.registerEntity(bundle)

    const event: UpstreamVersionChange = {
      workspaceId: WORKSPACE_ID,
      upstreamType: 'text_harness',
      oldVersionId: 'th-v1',
      newVersionId: 'th-v2-draft',
      isConfirmed: false,
    }

    const result = await service.handleUpstreamChange(event)
    expect(result.affectedEntities).toHaveLength(0)

    const entity = service.getEntity(WORKSPACE_ID, 'bnd-1')
    expect(entity?.isStale).toBe(false)
  })

  // Test 4: Text Harness new Confirmed activation -> 이후 Mission 새 version 사용
  it('4. binds new confirmed Text Harness version to subsequent missions', async () => {
    service.setActiveVersion(WORKSPACE_ID, 'text_harness', 'th-v1')
    expect(service.getActiveVersion(WORKSPACE_ID, 'text_harness')).toBe('th-v1')

    // Confirmed 승격
    await service.handleUpstreamChange({
      workspaceId: WORKSPACE_ID,
      upstreamType: 'text_harness',
      oldVersionId: 'th-v1',
      newVersionId: 'th-v2',
      isConfirmed: true,
    })

    expect(service.getActiveVersion(WORKSPACE_ID, 'text_harness')).toBe('th-v2')
    const mission = service.createMissionPlan(WORKSPACE_ID, 'mission-1')
    expect(mission.boundHarnessVersions.textHarnessVersionId).toBe('th-v2')
  })

  // Test 5: Image Harness new Confirmed activation -> pending creative policy대로 stale/reapproval
  it('5. invalidates pending creative approval when Image Harness is upgraded', async () => {
    const creative: DownstreamEntity = {
      id: 'cr-1',
      workspaceId: WORKSPACE_ID,
      type: 'creative_bundle',
      status: 'APPROVED',
      upstreamDependencies: {
        imageHarnessVersionId: 'ih-v1',
      },
      approvalFingerprint: 'fp-ih-v1-approved',
    }
    service.registerEntity(creative)

    await service.handleUpstreamChange({
      workspaceId: WORKSPACE_ID,
      upstreamType: 'image_harness',
      oldVersionId: 'ih-v1',
      newVersionId: 'ih-v2',
      isConfirmed: true,
    })

    const updated = service.getEntity(WORKSPACE_ID, 'cr-1')
    expect(updated?.isStale).toBe(true)
    expect(updated?.status).toBe('APPROVAL_INVALIDATED')
  })

  // Test 6: reference rights UNKNOWN/PROHIBITED 전환 -> pending publish fail-closed
  it('6. blocks pending publish when reference rights become PROHIBITED or UNKNOWN', async () => {
    const creativeWithRef: DownstreamEntity = {
      id: 'cr-ref-1',
      workspaceId: WORKSPACE_ID,
      type: 'creative_bundle',
      status: 'APPROVED',
      upstreamDependencies: {
        referenceAssetIds: ['ref-asset-1'],
      },
    }
    service.registerEntity(creativeWithRef)
    service.setReferenceRights(WORKSPACE_ID, 'ref-asset-1', 'APPROVED')

    // 권한 검증: 허용됨
    let admission = service.evaluatePublishEligibility(WORKSPACE_ID, 'cr-ref-1')
    expect(admission.eligible).toBe(true)

    // 권한이 PROHIBITED로 전환
    service.setReferenceRights(WORKSPACE_ID, 'ref-asset-1', 'PROHIBITED')
    admission = service.evaluatePublishEligibility(WORKSPACE_ID, 'cr-ref-1')
    expect(admission.eligible).toBe(false)
    expect(admission.reason).toContain('REFERENCE_RIGHTS_INVALIDATED')
  })

  // Test 7: approval fingerprint dependency 변경 -> old approval 실행 거절
  it('7. rejects old approval execution when fingerprint dependencies change', async () => {
    const bundle: DownstreamEntity = {
      id: 'cr-fp-1',
      workspaceId: WORKSPACE_ID,
      type: 'creative_bundle',
      status: 'APPROVED',
      upstreamDependencies: {
        textHarnessVersionId: 'th-v1',
        targetChannel: 'instagram',
      },
      approvalFingerprint: 'valid-fp-hash',
    }
    service.registerEntity(bundle)

    // 정상 상태
    const check1 = service.verifyApprovalIntegrity(WORKSPACE_ID, 'cr-fp-1', 'valid-fp-hash')
    expect(check1.valid).toBe(true)

    // target channel 변경 혹은 변조 발생 시
    const check2 = service.verifyApprovalIntegrity(WORKSPACE_ID, 'cr-fp-1', 'tampered-or-outdated-fp')
    expect(check2.valid).toBe(false)
    expect(check2.code).toBe('APPROVAL_FINGERPRINT_MISMATCH')
  })

  // Test 8: scheduled external action이 실행 직전 dependency mismatch -> 차단
  it('8. blocks scheduled external action at preflight execution if dependencies are stale', async () => {
    const schedule: DownstreamEntity = {
      id: 'sched-1',
      workspaceId: WORKSPACE_ID,
      type: 'schedule',
      status: 'SCHEDULED',
      upstreamDependencies: {
        operatingPolicyVersionId: 'op-v1',
        businessKnowledgeVersionId: 'bk-v1',
      },
    }
    service.registerEntity(schedule)

    // Operating Policy가 op-v2로 변경됨
    await service.handleUpstreamChange({
      workspaceId: WORKSPACE_ID,
      upstreamType: 'operating_policy',
      oldVersionId: 'op-v1',
      newVersionId: 'op-v2',
      isConfirmed: true,
    })

    const preflight = service.preflightScheduledExecution(WORKSPACE_ID, 'sched-1')
    expect(preflight.admitted).toBe(false)
    expect(preflight.code).toBe('SCHEDULE_BLOCKED_STALE')
  })

  // Test 9: already published historical record는 변경 없이 당시 lineage 유지
  it('9. preserves immutable historical lineage of already published items', async () => {
    const publishedRecord: DownstreamEntity = {
      id: 'hist-pub-1',
      workspaceId: WORKSPACE_ID,
      type: 'content_version',
      status: 'PUBLISHED',
      upstreamDependencies: {
        businessKnowledgeVersionId: 'bk-v1',
        textHarnessVersionId: 'th-v1',
        imageHarnessVersionId: 'ih-v1',
      },
      publishedAt: '2026-09-10T10:00:00Z',
    }
    service.registerEntity(publishedRecord)

    // 전 upstream 대규모 업데이트
    await service.handleUpstreamChange({
      workspaceId: WORKSPACE_ID,
      upstreamType: 'business_knowledge',
      oldVersionId: 'bk-v1',
      newVersionId: 'bk-v2',
      isConfirmed: true,
    })

    const record = service.getEntity(WORKSPACE_ID, 'hist-pub-1')
    expect(record?.status).toBe('PUBLISHED')
    expect(record?.isStale).toBe(false) // 발행 완료 기록은 STALE로 강제 격하되지 않고 불변 보존
    expect(record?.upstreamDependencies.businessKnowledgeVersionId).toBe('bk-v1')
  })

  // Test 10: cross-tenant invalidation event/entity injection deny
  it('10. denies cross-tenant invalidation events and entity lookups', async () => {
    const targetEntity: DownstreamEntity = {
      id: 'tenant-a-entity',
      workspaceId: WORKSPACE_ID,
      type: 'content_version',
      status: 'DRAFT',
      upstreamDependencies: {
        businessKnowledgeVersionId: 'bk-v1',
      },
    }
    service.registerEntity(targetEntity)

    // 타 테넌트에서 다른 테넌트 엔티티 조회/조작 시도
    expect(() => {
      service.getEntity(OTHER_WORKSPACE_ID, 'tenant-a-entity')
    }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)

    // 타 테넌트 이벤트로 다른 테넌트 엔티티 무효화 시도
    const crossEvent: UpstreamVersionChange = {
      workspaceId: OTHER_WORKSPACE_ID,
      upstreamType: 'business_knowledge',
      oldVersionId: 'bk-v1',
      newVersionId: 'bk-v2',
      isConfirmed: true,
      targetEntityId: 'tenant-a-entity',
    }
    await expect(service.handleUpstreamChange(crossEvent)).rejects.toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
  })

  // Test 11: cache invalidation 후 Owner/Admin/Agent same-truth
  it('11. ensures same-truth consistency across owner/admin/agent readers after invalidation', async () => {
    const entity: DownstreamEntity = {
      id: 'entity-same-truth',
      workspaceId: WORKSPACE_ID,
      type: 'content_version',
      status: 'PENDING_APPROVAL',
      upstreamDependencies: {
        textHarnessVersionId: 'th-v1',
      },
    }
    service.registerEntity(entity)

    // 1차 조회: 모두 stale 아님
    expect(service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'owner').isStale).toBe(false)
    expect(service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'admin').isStale).toBe(false)
    expect(service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'agent').isStale).toBe(false)

    // 무효화 실행
    await service.handleUpstreamChange({
      workspaceId: WORKSPACE_ID,
      upstreamType: 'text_harness',
      oldVersionId: 'th-v1',
      newVersionId: 'th-v2',
      isConfirmed: true,
    })

    // 무효화 후: 캐시 클리어 및 세 관점 모두 완전 일치
    const ownerView = service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'owner')
    const adminView = service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'admin')
    const agentView = service.getAuthoritativeState(WORKSPACE_ID, 'entity-same-truth', 'agent')

    expect(ownerView.isStale).toBe(true)
    expect(adminView.isStale).toBe(true)
    expect(agentView.isStale).toBe(true)
    expect(ownerView.status).toBe(adminView.status)
    expect(adminView.status).toBe(agentView.status)
  })
})
