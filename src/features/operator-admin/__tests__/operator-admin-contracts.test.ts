import { describe, it, expect } from 'vitest'
import { RuntimeFailureQueueService } from '../runtime-failure-queue'
import { OperatorMutationContractService } from '../operator-mutation-contract'
import { WorkspaceHealthCrmService } from '../workspace-health-crm'

describe('Operator Admin Contracts & Health CRM [ANI-465, ANI-466, ANI-471]', () => {
  describe('RuntimeFailureQueueService [ANI-465/J03]', () => {
    it('enqueues runtime failures and creates incident', () => {
      const failure = RuntimeFailureQueueService.enqueueFailure({
        workspaceId: 'ws-123',
        channel: 'INSTAGRAM',
        actionType: 'PUBLISH_FEED',
        errorMessage: 'Meta Graph API Token Timeout',
        failedAt: new Date().toISOString(),
        idempotencyKey: 'fail_idem_01'
      })

      expect(failure.id).toBeDefined()
      expect(failure.retryCount).toBe(0)

      const incident = RuntimeFailureQueueService.createIncidentFromFailures({
        severity: 'SEV2_HIGH',
        rootCause: 'Meta Graph API OAuth Token Timeout',
        affectedWorkspaces: ['ws-123']
      })

      expect(incident.status).toBe('OPEN')
      expect(incident.affectedWorkspaces).toContain('ws-123')

      const compensated = RuntimeFailureQueueService.issueCompensation(incident.incidentId, 350)
      expect(compensated?.status).toBe('COMPENSATED')
      expect(compensated?.compensationsIssuedSC).toBe(350)

      const resolved = RuntimeFailureQueueService.resolveIncident(incident.incidentId)
      expect(resolved?.status).toBe('RESOLVED')
    })
  })

  describe('OperatorMutationContractService [ANI-466/J04]', () => {
    it('executes mutation with expected_version optimistic locking', () => {
      const result = OperatorMutationContractService.executeMutation<{ active: boolean; updated?: boolean }>(
        {
          operatorId: 'admin-01',
          operatorRole: 'ADMIN',
          idempotencyKey: 'mut_idem_01',
          targetEntity: 'workspace_config',
          targetId: 'ws-123',
          expectedVersion: 1,
          mutationPayload: { active: true }
        },
        1,
        (p) => ({ ...p, updated: true })
      )

      expect(result.success).toBe(true)
      expect(result.newVersion).toBe(2)
      expect(result.data?.updated).toBe(true)
    })

    it('rejects mutation when expected_version does not match current version', () => {
      const result = OperatorMutationContractService.executeMutation(
        {
          operatorId: 'admin-01',
          operatorRole: 'ADMIN',
          idempotencyKey: 'mut_idem_conflict',
          targetEntity: 'workspace_config',
          targetId: 'ws-123',
          expectedVersion: 1,
          mutationPayload: { active: true }
        },
        2, // Conflict! Current is 2
        (p) => p
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('CONCURRENCY_CONFLICT')
    })
  })

  describe('WorkspaceHealthCrmService [ANI-471/J09]', () => {
    it('computes workspace health score and flags churn risk', () => {
      const healthy = WorkspaceHealthCrmService.calculateHealth({
        workspaceId: 'ws-active',
        businessName: '바이름 청라점',
        creditCapacitySC: 6000,
        creditsUsedSC: 2400,
        connectedChannelsCount: 3,
        daysSinceLastActivity: 1
      })

      expect(healthy.healthScore).toBeGreaterThanOrEqual(80)
      expect(healthy.churnRiskTier).toBe('LOW')

      const atRisk = WorkspaceHealthCrmService.calculateHealth({
        workspaceId: 'ws-dormant',
        businessName: '휴면 매장',
        creditCapacitySC: 6000,
        creditsUsedSC: 0,
        connectedChannelsCount: 0,
        daysSinceLastActivity: 10
      })

      expect(atRisk.healthScore).toBeLessThan(40)
      expect(atRisk.churnRiskTier).toBe('CRITICAL')
      expect(atRisk.recommendedOperatorAction).toContain('유선 상담')
    })
  })
})
