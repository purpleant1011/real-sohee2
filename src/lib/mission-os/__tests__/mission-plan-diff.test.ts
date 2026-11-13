import { describe, it, expect } from 'vitest'
import {
  computePlanDiff,
  parseMissionModificationIntent,
  type PlanDiffContext,
} from '../mission-plan-diff'
import type { MissionContract } from '../mission-contract'
import { assertControlGateActionAllowed } from '../mission-lineage-guard'

function createBaseContract(): MissionContract {
  return {
    contract_version: 1,
    goal: '가을 시그니처 펌 예약 10건 유치',
    success_criterion: {
      metric: 'verified_reservations',
      target_value: 10,
      baseline_value: 0,
      unit: '건',
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
      evaluation_interval_hours: 6,
    },
    service_scope: ['instagram', 'threads'],
    allowed_actions: ['PUBLISH_POST', 'SEND_DM'],
    forbidden_actions: ['DISCOUNT_OVER_30_PERCENT'],
    budget_caps: {
      max_cost_minor_units: 5000000, // 50,000 KRW
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: { base_fact: 'fact_v1' },
    policy_version: '2026-10-v1',
    approval_fingerprint: 'a'.repeat(64),
    owner_actor: {
      actor_type: 'user',
      actor_id: 'owner_1',
    },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2026-11-05T00:00:00.000Z',
  }
}

describe('ANI-1809: Conversational Mission PlanDiff Engine', () => {
  const context: PlanDiffContext = {
    missionId: 'msn_test_123',
    expectedSnapshotVersion: 3,
    alreadySubmittedEffects: [
      {
        effect_id: 'eff_1',
        action_type: 'PUBLISH_POST',
        target_channel: 'instagram',
        status: 'VERIFIED',
        submitted_at: '2026-10-27T01:00:00.000Z',
      },
    ],
    unexecutedSteps: ['스레드 포스트 예약 발행', '인스타그램 추가 스토리 게시'],
    existingApprovals: ['appr_past_1'],
  }

  it('"인스타만, 예산 그대로" retains the same mission_id and does NOT create a new mission or change pricing', () => {
    const baseContract = createBaseContract()
    const result = parseMissionModificationIntent('인스타만 해줘, 예산 그대로', baseContract, context)

    expect(result.isAmbiguous).toBe(false)
    expect(result.isPauseIntent).toBe(false)
    expect(result.planDiff).not.toBeNull()

    const diff = result.planDiff!
    // 1. Same mission identity maintained
    expect(diff.mission_id).toBe('msn_test_123')
    // 2. Increments version from 1 to 2
    expect(diff.old_contract_version).toBe(1)
    expect(diff.new_contract_version).toBe(2)
    // 3. Service scope restricted to instagram only
    expect(diff.proposed_contract.service_scope).toEqual(['instagram'])
    // 4. Budget strictly preserved
    expect(diff.proposed_contract.budget_caps.max_cost_minor_units).toBe(5000000)
    expect(diff.cost_difference_minor_units).toBe(0)
    // 5. Preserved constraints explicitly recorded
    expect(diff.preserved_constraints.some((c) => c.includes('예산 상한 및 통화 유지'))).toBe(true)
    // 6. Impacted unexecuted steps detected (Threads step is impacted)
    expect(diff.impacted_unexecuted_steps).toContain('스레드 포스트 예약 발행')
    // 7. Already submitted effect is preserved and protected
    expect(diff.already_submitted_effects).toHaveLength(1)
    expect(diff.already_submitted_effects[0].status).toBe('VERIFIED')
  })

  it('vague/ambiguous input ("그거 좀 바꿔줘") causes ZERO writes and returns clarification prompt', () => {
    const baseContract = createBaseContract()
    const result = parseMissionModificationIntent('그거 좀 바꿔줘', baseContract, context)

    expect(result.planDiff).toBeNull()
    expect(result.isAmbiguous).toBe(true)
    expect(result.clarificationPrompt).toContain('어떤 부분을 변경할까요?')
  })

  it('detects nested tampering: nested budget_caps modification produces a different payload_hash', () => {
    const baseContract = createBaseContract()
    const patch1: Partial<MissionContract> = {
      budget_caps: {
        max_cost_minor_units: 5000000,
        currency: 'KRW',
      },
    }
    const patch2: Partial<MissionContract> = {
      budget_caps: {
        max_cost_minor_units: 6000000, // Tampered nested budget
        currency: 'KRW',
      },
    }

    const diff1 = computePlanDiff(baseContract, patch1, context)
    const diff2 = computePlanDiff(baseContract, patch2, context)

    expect(diff1.payload_hash).not.toBe(diff2.payload_hash)
    expect(diff2.cost_difference_minor_units).toBe(1000000)
  })

  it('strictly protects immutable fields: owner_actor and forbidden_actions cannot be forged by patch', () => {
    const baseContract = createBaseContract()
    const maliciousPatch: any = {
      service_scope: ['instagram'],
      owner_actor: { actor_type: 'anonymous_attacker', actor_id: 'bad_actor' }, // Malicious forge
      forbidden_actions: [], // Attempt to drop security policy
    }

    const diff = computePlanDiff(baseContract, maliciousPatch, context)
    // 1. owner_actor must NOT be forged
    expect(diff.proposed_contract.owner_actor).toEqual({
      actor_type: 'user',
      actor_id: 'owner_1',
    })
    // 2. forbidden_actions must NOT be relaxed
    expect(diff.proposed_contract.forbidden_actions).toContain('DISCOUNT_OVER_30_PERCENT')
    // 3. approval_fingerprint is invalidated
    expect(diff.proposed_contract.approval_fingerprint).toBeNull()
  })

  it('pause intent ("그만해 / 멈춰") returns pause intent without mutating external provider', () => {
    const baseContract = createBaseContract()
    const result = parseMissionModificationIntent('잠깐 멈춰봐', baseContract, context)

    expect(result.planDiff).toBeNull()
    expect(result.isPauseIntent).toBe(true)
    expect(result.clarificationPrompt).toContain('일시정지')
  })

  it('computes budget increase correctly when explicitly instructed', () => {
    const baseContract = createBaseContract()
    const result = parseMissionModificationIntent('예산 10만원으로 올려줘', baseContract, context)

    expect(result.planDiff).not.toBeNull()
    const diff = result.planDiff!
    expect(diff.proposed_contract.budget_caps.max_cost_minor_units).toBe(100000)
    expect(diff.cost_difference_minor_units).toBe(100000 - 5000000)
    expect(diff.requires_reapproval).toBe(true)
  })

  it('generates consistent payload_hash and idempotency_key for identical patches', () => {
    const baseContract = createBaseContract()
    const diff1 = computePlanDiff(baseContract, { service_scope: ['instagram'] }, context)
    const diff2 = computePlanDiff(baseContract, { service_scope: ['instagram'] }, context)

    expect(diff1.payload_hash).toBe(diff2.payload_hash)
    expect(diff1.idempotency_key).toBe(diff2.idempotency_key)
  })
})

describe('ANI-1809 / ANI-1880: Control Epoch & Worker Gate Invariants', () => {
  it('assertControlGateActionAllowed blocks NEW_WRITE when worker observed epoch is stale', () => {
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'RUNNING',
        actionType: 'NEW_WRITE',
        controlEpoch: 2, // authoritative epoch bumped to 2 after pause/re-plan
        workerObservedEpoch: 1, // worker dispatched with epoch 1 (stale race)
      })
    ).toThrowError(/CONTROL_GATE_STALE_EPOCH/)
  })

  it('assertControlGateActionAllowed ALLOWS READBACK even when worker observed epoch is stale or paused', () => {
    // Readback of in-flight external attempts MUST ALWAYS be preserved
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSED',
        actionType: 'READBACK',
        controlEpoch: 5,
        workerObservedEpoch: 1,
      })
    ).not.toThrow()
  })

  it('assertControlGateActionAllowed ALLOWS RECONCILIATION even past deadline', () => {
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'CLOSED',
        actionType: 'RECONCILIATION',
        controlEpoch: 3,
        workerObservedEpoch: 3,
      })
    ).not.toThrow()
  })

  it('assertControlGateActionAllowed blocks NEW_WRITE when executionState is PAUSED or PAUSING', () => {
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSED',
        actionType: 'NEW_WRITE',
        controlEpoch: 1,
        workerObservedEpoch: 1,
      })
    ).toThrowError(/CONTROL_GATE_BLOCKED/)

    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSING',
        actionType: 'NEW_WRITE',
        controlEpoch: 1,
        workerObservedEpoch: 1,
      })
    ).toThrowError(/CONTROL_GATE_BLOCKED/)
  })
})
