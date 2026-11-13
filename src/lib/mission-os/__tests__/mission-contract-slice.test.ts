import { describe, it, expect, vi } from 'vitest'
import {
  validateMissionContract,
  evaluateOutcomeState,
  type MissionContract,
  type ObservationEvidence,
} from '../mission-contract'
import {
  assertOutcomeEvidenceInvariant,
  mapLegacyStatusToDualState,
} from '../mission-state-machine'
import {
  assertStrictLineage,
  validateMultiReceiptLineage,
  assertControlGateActionAllowed,
  isReceiptObservedVerified,
  type MultiActionReceiptEntry,
} from '../mission-lineage-guard'
import { MissionRepository } from '../mission-repository'
import {
  buildCanonicalMissionDTO,
  buildCanonicalMissionSnapshot,
  buildAgentMissionContext,
} from '../mission-read-model'
import type { MarketingMissionAggregate } from '../mission-types'

function createValidContractFixture(overrides: Partial<MissionContract> = {}): MissionContract {
  return {
    contract_version: 1,
    goal: '인스타그램 가을 프로모션 예약 10건 달성',
    success_criterion: {
      metric: 'verified_reservations',
      target_value: 10,
      baseline_value: 0,
      unit: 'reservations',
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
      evaluation_interval_hours: 6,
    },
    service_scope: ['instagram', 'booking_service'],
    allowed_actions: ['PUBLISH_POST', 'SEND_DM', 'RESERVE_SLOT'],
    forbidden_actions: ['DISCOUNT_OVER_30_PERCENT'],
    budget_caps: {
      max_cost_minor_units: 5000000,
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: { menu_v1: 'sha256:abc' },
    policy_version: '2026-10-autumn-v1',
    approval_fingerprint: null,
    owner_actor: {
      actor_type: 'user',
      actor_id: 'user-owner-123',
    },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2026-11-05T00:00:00.000Z',
    ...overrides,
  }
}

describe('MissionContract Validation & Fail-Closed Invariants', () => {
  it('accepts a strictly valid contract', () => {
    const valid = createValidContractFixture()
    const result = validateMissionContract(valid)
    expect(result.goal).toBe(valid.goal)
    expect(result.contract_version).toBe(1)
  })

  it('rejects invalid dates (end_at <= start_at or expires_at <= effective_at)', () => {
    const invertedWindow = createValidContractFixture({
      observation_window: {
        start_at: '2026-11-03T00:00:00.000Z',
        end_at: '2026-10-27T00:00:00.000Z',
      },
    })
    expect(() => validateMissionContract(invertedWindow)).toThrow(
      '[INVALID_MISSION_CONTRACT] observation_window.end_at'
    )

    const invertedExpires = createValidContractFixture({
      effective_at: '2026-11-05T00:00:00.000Z',
      expires_at: '2026-11-01T00:00:00.000Z',
    })
    expect(() => validateMissionContract(invertedExpires)).toThrow(
      '[INVALID_MISSION_CONTRACT] expires_at'
    )
  })

  it('rejects invalid costs (negative, non-integer, NaN)', () => {
    const negativeCost = createValidContractFixture({
      budget_caps: { max_cost_minor_units: -100, currency: 'KRW' },
    })
    expect(() => validateMissionContract(negativeCost)).toThrow(
      '[INVALID_MISSION_CONTRACT] budget_caps.max_cost_minor_units'
    )

    const floatCost = createValidContractFixture({
      budget_caps: { max_cost_minor_units: 123.45, currency: 'KRW' },
    })
    expect(() => validateMissionContract(floatCost)).toThrow(
      '[INVALID_MISSION_CONTRACT] budget_caps.max_cost_minor_units'
    )
  })

  it('rejects target_value NaN/Infinity, array with empty strings, and invalid actor enum', () => {
    const nanTarget = createValidContractFixture({
      success_criterion: { metric: 'metric', target_value: NaN },
    })
    expect(() => validateMissionContract(nanTarget)).toThrow(
      '[INVALID_MISSION_CONTRACT] success_criterion.target_value must be a finite non-negative number'
    )

    const emptyScopeItem = createValidContractFixture({
      service_scope: ['instagram', '  '],
    })
    expect(() => validateMissionContract(emptyScopeItem)).toThrow(
      '[INVALID_MISSION_CONTRACT] Every service_scope item must be a non-empty string'
    )

    const invalidActor = createValidContractFixture({
      owner_actor: { actor_type: 'hacker' as any },
    })
    expect(() => validateMissionContract(invalidActor)).toThrow(
      "[INVALID_MISSION_CONTRACT] Invalid owner_actor.actor_type 'hacker'"
    )

    const floatEscalations = createValidContractFixture({
      attention_policy: { max_escalations: 1.5, notify_on_breach: true },
    })
    expect(() => validateMissionContract(floatEscalations)).toThrow(
      '[INVALID_MISSION_CONTRACT] attention_policy.max_escalations must be a non-negative integer'
    )
  })
})

describe('Dual State & Observation Evaluation (Posted != Achieved Invariant)', () => {
  const contract = createValidContractFixture()

  it('prohibits claiming ACHIEVED_VERIFIED purely from external action receipt without observations', () => {
    expect(() =>
      assertOutcomeEvidenceInvariant({
        targetOutcome: 'ACHIEVED_VERIFIED',
        contract,
        evidence: null,
        receiptId: 'rcpt-instagram-post-999',
      })
    ).toThrow('[POSTED_IS_NOT_ACHIEVED]')
  })

  it('evaluates outcome as ACHIEVED_VERIFIED only when observed inside window with authorized channel and target met', () => {
    const validEvidence: ObservationEvidence = {
      status: 'OBSERVED',
      observed_value: 12,
      observed_at: '2026-10-28T12:00:00.000Z',
      source_channel: 'instagram',
    }
    const outcome = evaluateOutcomeState(contract, validEvidence, '2026-10-29T00:00:00.000Z')
    expect(outcome).toBe('ACHIEVED_VERIFIED')
  })

  it('rejects observation outside window or from unauthorized source channel (fail-closed)', () => {
    const outOfWindowEvidence: ObservationEvidence = {
      status: 'OBSERVED',
      observed_value: 15,
      observed_at: '2026-11-10T12:00:00.000Z', // Past end_at (2026-11-03)
      source_channel: 'instagram',
    }
    // Past window with invalid observation evidence falls back to NOT_OBSERVABLE
    const outcome = evaluateOutcomeState(contract, outOfWindowEvidence, '2026-11-11T00:00:00.000Z')
    expect(outcome).toBe('NOT_OBSERVABLE')

    const unauthorizedSourceEvidence: ObservationEvidence = {
      status: 'OBSERVED',
      observed_value: 15,
      observed_at: '2026-10-28T12:00:00.000Z',
      source_channel: 'tiktok_fake',
    }
    const outcome2 = evaluateOutcomeState(contract, unauthorizedSourceEvidence, '2026-11-11T00:00:00.000Z')
    expect(outcome2).toBe('NOT_OBSERVABLE')
  })

  it('rejects future observation timestamps relative to current evaluation time', () => {
    const futureEvidence: ObservationEvidence = {
      status: 'OBSERVED',
      observed_value: 15,
      observed_at: '2026-10-30T12:00:00.000Z', // In future relative to now (2026-10-28)
      source_channel: 'instagram',
    }
    const outcome = evaluateOutcomeState(contract, futureEvidence, '2026-10-28T00:00:00.000Z')
    expect(outcome).toBe('PENDING')
  })

  it('distinguishes NOT_OBSERVED from proven failure (VERIFIED_ZERO)', () => {
    // When deadline passes with NOT_OBSERVED -> NOT_OBSERVABLE (NOT NOT_ACHIEVED: unobserved != zero)
    const unobservedOutcome = evaluateOutcomeState(
      contract,
      { status: 'NOT_OBSERVED' },
      '2026-11-04T00:00:00.000Z'
    )
    expect(unobservedOutcome).toBe('NOT_OBSERVABLE')

    // When deadline passes with VERIFIED_ZERO -> NOT_ACHIEVED_IN_WINDOW (verified failure to convert)
    const verifiedZeroOutcome = evaluateOutcomeState(
      contract,
      {
        status: 'VERIFIED_ZERO',
        observed_at: '2026-10-28T12:00:00.000Z',
        source_channel: 'instagram',
      },
      '2026-11-04T00:00:00.000Z'
    )
    expect(verifiedZeroOutcome).toBe('NOT_ACHIEVED_IN_WINDOW')
  })

  it('handles VERIFIED_ZERO when target is 0 and timing/source are verified', () => {
    const zeroTargetContract = createValidContractFixture({
      success_criterion: { metric: 'customer_complaints', target_value: 0 },
    })
    const zeroEvidence: ObservationEvidence = {
      status: 'VERIFIED_ZERO',
      observed_at: '2026-10-28T12:00:00.000Z',
      source_channel: 'instagram',
    }
    const outcome = evaluateOutcomeState(zeroTargetContract, zeroEvidence, '2026-10-29T00:00:00.000Z')
    expect(outcome).toBe('ACHIEVED_VERIFIED')
  })

  it('does not verify an outcome when the evaluation clock is invalid', () => {
    expect(evaluateOutcomeState(contract, {
      status: 'OBSERVED', observed_value: 12,
      observed_at: '2026-10-28T12:00:00.000Z', source_channel: 'instagram',
    }, 'invalid')).toBe('PENDING')
  })

  it.each([
    { status: 'OBSERVED', observed_value: Number.NaN },
    { status: 'OBSERVED', observed_value: Number.POSITIVE_INFINITY },
    { status: 'OBSERVED', observed_value: 12, source_channel: 'unauthorized' },
    { status: 'OBSERVED', observed_value: 12, observed_at: '2026-11-10T00:00:00.000Z' },
    { status: 'OBSERVED', observed_value: 12, observed_at: '2026-10-30T00:00:00.000Z' },
  ] as const)('rejects a direct verified transition with invalid evidence %j', override => {
    expect(() => assertOutcomeEvidenceInvariant({
      targetOutcome: 'ACHIEVED_VERIFIED', contract, nowIso: '2026-10-29T00:00:00.000Z',
      evidence: {
        observed_at: '2026-10-28T12:00:00.000Z', source_channel: 'instagram',
        ...override,
      },
    })).toThrow('UNVERIFIED_OUTCOME_VIOLATION')
  })

  it.each(['OBSERVED', 'VERIFIED_ZERO'] as const)('accepts valid %s evidence with the supplied evaluation clock', status => {
    const evidence: ObservationEvidence = {
      status, observed_value: 12,
      observed_at: '2026-10-28T12:00:00.000Z', source_channel: 'instagram',
    }
    const validContract = status === 'VERIFIED_ZERO'
      ? createValidContractFixture({ success_criterion: { metric: 'customer_complaints', target_value: 0 } })
      : contract
    expect(() => assertOutcomeEvidenceInvariant({
      targetOutcome: 'ACHIEVED_VERIFIED', contract: validContract, evidence,
      nowIso: '2026-10-29T00:00:00.000Z',
    })).not.toThrow()
    expect(() => assertOutcomeEvidenceInvariant({
      targetOutcome: 'ACHIEVED_VERIFIED', contract: validContract, evidence, nowIso: 'invalid',
    })).toThrow('UNVERIFIED_OUTCOME_VIOLATION')
  })

  it('uses the same evaluation clock when recording verified evidence', async () => {
    const futureContract = createValidContractFixture({
      observation_window: { start_at: '2099-01-01T00:00:00.000Z', end_at: '2099-01-03T00:00:00.000Z' },
    })
    const current = {
      id: 'mission-1', workspace_id: 'workspace-1', trace_id: 'trace-1', status: 'PUBLISHED_VERIFIED',
      metadata: { contract: futureContract, outcome_state: 'PENDING' },
    }
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: current, error: null }),
    }
    const rpc = vi.fn().mockResolvedValue({ data: { ...current, snapshot_version: 2 }, error: null })
    const repository = new MissionRepository({ from: vi.fn().mockReturnValue(query), rpc } as any)
    await repository.recordObservationEvidence({
      workspaceId: current.workspace_id, missionId: current.id, traceId: current.trace_id,
      expectedSnapshotVersion: 1, nowIso: '2099-01-02T00:00:00.000Z',
      evidence: {
        status: 'OBSERVED', observed_value: 12,
        observed_at: '2099-01-01T12:00:00.000Z', source_channel: 'instagram',
      },
    })
    expect(rpc).toHaveBeenCalledWith('update_mission_snapshot_atomic', expect.objectContaining({
      p_new_metadata: expect.objectContaining({ outcome_state: 'ACHIEVED_VERIFIED' }),
    }))
  })

  it('preserves legacy COMPLETED as outcome PENDING/NOT_OBSERVED without synthetic success', () => {
    const legacyRow = mapLegacyStatusToDualState('COMPLETED', {})
    expect(legacyRow.executionState).toBe('CLOSED')
    expect(legacyRow.outcomeState).toBe('PENDING') // NOT ACHIEVED_VERIFIED!
  })
})

describe('Multi-Receipt Lineage & Control Gate Invariants', () => {
  const contract = createValidContractFixture()

  it('rejects duplicate receipt IDs and duplicate action fingerprints', () => {
    const existing: MultiActionReceiptEntry[] = [
      {
        receiptId: 'rcpt-001',
        actionFingerprint: 'fp-publish-feed-1',
        provider: 'instagram',
        createdAt: '2026-10-27T10:00:00.000Z',
      },
    ]

    const dupId: MultiActionReceiptEntry = {
      receiptId: 'rcpt-001',
      actionFingerprint: 'fp-publish-feed-2',
      provider: 'instagram',
      createdAt: '2026-10-27T11:00:00.000Z',
    }
    expect(() => validateMultiReceiptLineage(existing, dupId)).toThrow('[DUPLICATE_RECEIPT_BLOCKED]')

    const dupFingerprint: MultiActionReceiptEntry = {
      receiptId: 'rcpt-002',
      actionFingerprint: 'fp-publish-feed-1',
      provider: 'instagram',
      createdAt: '2026-10-27T11:00:00.000Z',
    }
    expect(() => validateMultiReceiptLineage(existing, dupFingerprint)).toThrow(
      '[DUPLICATE_ACTION_MUTATION_BLOCKED]'
    )
  })

  it('blocks NEW_WRITE when paused or expired, but PRESERVES readback and reconciliation', () => {
    // 1. Paused state
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSED',
        contract,
        actionType: 'NEW_WRITE',
      })
    ).toThrow('[CONTROL_GATE_BLOCKED]')

    // Readback & Reconciliation are allowed while paused
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSED',
        contract,
        actionType: 'READBACK',
      })
    ).not.toThrow()
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'PAUSED',
        contract,
        actionType: 'RECONCILIATION',
      })
    ).not.toThrow()

    // 2. Expired deadline
    const expiredTime = '2026-11-10T00:00:00.000Z'
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'RUNNING',
        contract,
        actionType: 'NEW_WRITE',
        nowIso: expiredTime,
      })
    ).toThrow('[CONTROL_GATE_EXPIRED]')

    // Readback & Reconciliation are preserved after expiration
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'RUNNING',
        contract,
        actionType: 'READBACK',
        nowIso: expiredTime,
      })
    ).not.toThrow()
    expect(() =>
      assertControlGateActionAllowed({
        executionState: 'RUNNING',
        contract,
        actionType: 'RECONCILIATION',
        nowIso: expiredTime,
      })
    ).not.toThrow()
  })

  it('enforces tenant boundary strictly in envelope correlation', () => {
    expect(() =>
      assertStrictLineage(
        { workspaceId: 'ws-tenant-a', missionId: 'm-1', traceId: 'tr-1' },
        { workspaceId: 'ws-tenant-b', missionId: 'm-1', traceId: 'tr-1' }
      )
    ).toThrow('[LINEAGE_WORKSPACE_MISMATCH]')
  })
})

describe('MissionRepository Slice & Optimistic Snapshot Concurrency', () => {
  function createMockSupabase(initialMission: any = null) {
    let storedMission = initialMission ? { ...initialMission } : null
    const events: any[] = []
    const receipts: any[] = []

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_missions') {
          return {
            insert: vi.fn((payload: any) => ({
              select: () => ({
                single: async () => {
                  storedMission = { id: 'm-generated-uuid', ...payload }
                  return { data: storedMission, error: null }
                },
              }),
            })),
            select: vi.fn(() => ({
              eq: vi.fn((col1: string, val1: any) => ({
                eq: vi.fn((col2: string, val2: any) => ({
                  single: async () => {
                    if (!storedMission) return { data: null, error: { message: 'Not found' } }
                    if (storedMission[col1] !== val1 || storedMission[col2] !== val2) {
                      return { data: null, error: { message: 'Row mismatch' } }
                    }
                    return { data: storedMission, error: null }
                  },
                  maybeSingle: async () => {
                    if (!storedMission || storedMission[col1] !== val1 || storedMission[col2] !== val2) {
                      return { data: null, error: null }
                    }
                    return { data: storedMission, error: null }
                  },
                })),
                order: vi.fn(() => ({
                  limit: async () => ({
                    data: storedMission && storedMission[col1] === val1 ? [storedMission] : [],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((col1: string, val1: any) => ({
                eq: vi.fn((col2: string, val2: any) => ({
                  select: () => ({
                    single: async () => {
                      if (!storedMission) return { data: null, error: { message: 'Not found' } }
                      storedMission = { ...storedMission, ...updates }
                      return { data: storedMission, error: null }
                    },
                  }),
                })),
              })),
            })),
          }
        }
        if (table === 'mission_events') {
          return {
            insert: vi.fn(async (eventPayload: any) => {
              events.push(eventPayload)
              return { error: null }
            }),
          }
        }
        if (table === 'mission_action_receipts') {
          return {
            insert: vi.fn(async (receiptPayload: any) => {
              receipts.push(receiptPayload)
              return { error: null }
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn(async (fnName: string, args: any) => {
        if (fnName === 'create_mission_with_contract_atomic') {
          storedMission = {
            id: 'm-generated-uuid',
            workspace_id: args.p_workspace_id,
            trace_id: args.p_trace_id,
            status: args.p_status,
            goal: args.p_goal,
            metadata: args.p_metadata,
          }
          events.push({ event_name: args.p_event_name, payload: args.p_event_payload })
          return { data: storedMission, error: null }
        }
        if (fnName === 'update_mission_snapshot_atomic') {
          if (!storedMission) {
            return { data: null, error: { message: '[MISSION_NOT_FOUND]' } }
          }
          const currentVersion = (storedMission.metadata?.snapshot_version as number) || 1
          if (args.p_expected_snapshot_version !== currentVersion) {
            return {
              data: null,
              error: {
                message: `[STALE_SNAPSHOT_VERSION] Concurrency conflict: current snapshot version ${currentVersion} does not match expected ${args.p_expected_snapshot_version}`,
              },
            }
          }
          const nextVersion = currentVersion + 1
          const fromStatus = storedMission.status
          let finalMetadata = {
            ...(storedMission.metadata || {}),
            ...(args.p_new_metadata || {}),
          }

          if (args.p_receipt_entry) {
            const receiptEntry = args.p_receipt_entry
            // Ledger normalization
            if (Array.isArray(finalMetadata.multi_receipts)) {
              finalMetadata.multi_receipts = finalMetadata.multi_receipts.map((r: any) => {
                if (r.receiptId === receiptEntry.receipt_id || r.receipt_id === receiptEntry.receipt_id) {
                  return {
                    ...r,
                    actionRequestId: receiptEntry.action_request_id,
                    action_request_id: receiptEntry.action_request_id,
                    verifiedAt: receiptEntry.verified_at,
                    verified_at: receiptEntry.verified_at,
                  }
                }
                return r
              })
            }
            if (!receiptEntry.verified_at && finalMetadata.execution_state === 'OBSERVING') {
              finalMetadata.execution_state = 'WAITING_EXTERNAL'
            }
            receipts.push({
              workspace_id: args.p_workspace_id,
              mission_id: args.p_mission_id,
              action_request_id: receiptEntry.action_request_id,
              action_receipt_id: receiptEntry.receipt_id,
              action_fingerprint: receiptEntry.action_fingerprint,
              provider: receiptEntry.provider,
              cost_minor_units: receiptEntry.cost_minor_units,
              verified_at: receiptEntry.verified_at,
            })
          }

          storedMission = {
            ...storedMission,
            status: args.p_new_status || storedMission.status,
            goal: args.p_new_goal || storedMission.goal,
            external_action_receipt_id: args.p_new_receipt_id || storedMission.external_action_receipt_id,
            metadata: {
              ...finalMetadata,
              snapshot_version: nextVersion,
            },
            updated_at: new Date().toISOString(),
          }
          events.push({
            workspace_id: args.p_workspace_id,
            mission_id: args.p_mission_id,
            from_status: fromStatus,
            to_status: storedMission.status,
            actor_type: args.p_actor_type,
            actor_id: args.p_actor_id,
            event_name: args.p_event_name,
            payload: {
              ...(args.p_event_payload || {}),
              applied_snapshot_version: nextVersion,
            },
            occurred_at: storedMission.updated_at,
          })
          return { data: storedMission, error: null }
        }
        throw new Error(`Unexpected RPC: ${fnName}`)
      }),
    }
    return { mockClient, getStored: () => storedMission, getEvents: () => events, getReceipts: () => receipts }
  }

  it('creates a mission with validated contract and initializes snapshot_version to 1', async () => {
    const { mockClient, getStored, getEvents } = createMockSupabase()
    const repo = new MissionRepository(mockClient as any)

    const contract = createValidContractFixture()
    const created = await repo.createMissionWithContract({
      workspaceId: 'ws-tenant-1',
      traceId: 'tr-001',
      contract,
    })

    expect(created.id).toBe('m-generated-uuid')
    expect(created.status).toBe('RECEIVED')
    expect(created.metadata.snapshot_version).toBe(1)
    expect(created.metadata.execution_state).toBe('DRAFT')
    expect(created.metadata.outcome_state).toBe('PENDING')
    expect(getEvents().length).toBe(1)
    expect(getEvents()[0].event_name).toBe('MISSION_CONTRACT_INITIALIZED')
  })

  it('rejects stale snapshot update and increments snapshot_version on valid concurrent update', async () => {
    const contract = createValidContractFixture()
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-100',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-100',
      status: 'RECEIVED',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Stale update attempt (expecting version 2 when stored is 1)
    await expect(
      repo.updateMissionContract({
        workspaceId: 'ws-tenant-1',
        missionId: 'm-100',
        traceId: 'tr-100',
        expectedSnapshotVersion: 2, // STALE!
        newContract: createValidContractFixture({ contract_version: 2 }),
      })
    ).rejects.toThrow('[STALE_SNAPSHOT_VERSION]')

    // Valid update with expected version 1 -> bumps to 2
    const updated = await repo.updateMissionContract({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-100',
      traceId: 'tr-100',
      expectedSnapshotVersion: 1,
      newContract: createValidContractFixture({ contract_version: 2, goal: '새 목표' }),
    })

    expect(updated.metadata.snapshot_version).toBe(2)
    expect(getStored().metadata.snapshot_version).toBe(2)
  })

  it('rejects contract update if contract_version is not strictly incremented', async () => {
    const contract = createValidContractFixture({ contract_version: 2 })
    const { mockClient } = createMockSupabase({
      id: 'm-101',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-101',
      status: 'RECEIVED',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Attempting same contract_version 2 (not incremented)
    await expect(
      repo.updateMissionContract({
        workspaceId: 'ws-tenant-1',
        missionId: 'm-101',
        traceId: 'tr-101',
        expectedSnapshotVersion: 1,
        newContract: createValidContractFixture({ contract_version: 2 }),
      })
    ).rejects.toThrow('[CONTRACT_VERSION_NOT_INCREMENTED]')

    // Attempting lesser contract_version 1
    await expect(
      repo.updateMissionContract({
        workspaceId: 'ws-tenant-1',
        missionId: 'm-101',
        traceId: 'tr-101',
        expectedSnapshotVersion: 1,
        newContract: createValidContractFixture({ contract_version: 1 }),
      })
    ).rejects.toThrow('[CONTRACT_VERSION_NOT_INCREMENTED]')
  })

  it('invalidates stale outcome evidence and resets outcome_state to PENDING on contract update to prevent ACHIEVED leakage', async () => {
    const initialContract = createValidContractFixture({
      contract_version: 1,
      success_criterion: { metric: 'bookings', target_value: 10 },
      observation_window: {
        start_at: '2026-10-27T00:00:00.000Z',
        end_at: '2026-11-03T00:00:00.000Z',
      },
    })
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-102',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-102',
      status: 'OUTCOME_OBSERVED',
      goal: initialContract.goal,
      external_action_receipt_id: 'rcpt-existing-1',
      metadata: {
        contract: initialContract,
        snapshot_version: 2,
        execution_state: 'OBSERVING',
        outcome_state: 'ACHIEVED_VERIFIED', // Previously achieved under v1
        observation_evidence: {
          status: 'OBSERVED',
          observed_value: 10,
          observed_at: '2026-10-28T12:00:00.000Z',
          source_channel: 'instagram',
        },
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Contract v2 sets a higher target (20) which the previous evidence (10) cannot satisfy
    const contractV2 = createValidContractFixture({
      contract_version: 2,
      goal: '새로운 20건 예약 목표',
      success_criterion: { metric: 'bookings', target_value: 20 },
      observation_window: {
        start_at: '2026-11-01T00:00:00.000Z',
        end_at: '2026-11-08T00:00:00.000Z',
      },
    })

    const updated = await repo.updateMissionContract({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-102',
      traceId: 'tr-102',
      expectedSnapshotVersion: 2,
      newContract: contractV2,
    })

    // Outcome state must NOT leak previous ACHIEVED_VERIFIED; evidence must be invalidated
    expect(updated.metadata.outcome_state).toBe('PENDING')
    expect(updated.metadata.observation_evidence).toBeNull()
    // Status must revert safely from OUTCOME_OBSERVED to safe RECEIVED (not elevated merely by receipt)
    expect(updated.status).toBe('RECEIVED')
    expect(getStored().metadata.outcome_state).toBe('PENDING')
    expect(getStored().metadata.observation_evidence).toBeNull()
  })

  it('unconditionally invalidates evidence and resets outcome_state to PENDING when metric changes (bookings -> revenue) with identical target/window', async () => {
    // Regression test: ObservationEvidence has no metric/contract_version field,
    // so if target_value (10), window, and evidence are identical, naive re-evaluation would retain ACHIEVED_VERIFIED.
    const initialContract = createValidContractFixture({
      contract_version: 1,
      goal: '예약 10건 유치',
      success_criterion: { metric: 'bookings', target_value: 10 },
      observation_window: {
        start_at: '2026-10-27T00:00:00.000Z',
        end_at: '2026-11-03T00:00:00.000Z',
      },
    })
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-103',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-103',
      status: 'OUTCOME_OBSERVED',
      goal: initialContract.goal,
      external_action_receipt_id: 'rcpt-existing-1',
      metadata: {
        contract: initialContract,
        snapshot_version: 2,
        execution_state: 'OBSERVING',
        outcome_state: 'ACHIEVED_VERIFIED', // Achieved 10 bookings
        observation_evidence: {
          status: 'OBSERVED',
          observed_value: 10,
          observed_at: '2026-10-28T12:00:00.000Z',
          source_channel: 'instagram',
        },
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Contract v2 keeps target_value: 10 and window identical, but changes metric to 'revenue' (10원/10만원 매출)
    const contractV2 = createValidContractFixture({
      contract_version: 2,
      goal: '매출 10 달성',
      success_criterion: { metric: 'revenue', target_value: 10 },
      observation_window: {
        start_at: '2026-10-27T00:00:00.000Z',
        end_at: '2026-11-03T00:00:00.000Z',
      },
    })

    const updated = await repo.updateMissionContract({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-103',
      traceId: 'tr-103',
      expectedSnapshotVersion: 2,
      newContract: contractV2,
    })

    // Evidence must be completely null and outcome_state must be PENDING (zero stale leakage across metrics)
    expect(updated.metadata.outcome_state).toBe('PENDING')
    expect(updated.metadata.observation_evidence).toBeNull()
    expect(updated.status).toBe('RECEIVED')
    expect(getStored().metadata.outcome_state).toBe('PENDING')
    expect(getStored().metadata.observation_evidence).toBeNull()
    expect(getStored().status).toBe('RECEIVED')
  })

  it('sets execution_state to WAITING_EXTERNAL for unverified receipt and normalizes metadata ledger values', async () => {
    const contract = createValidContractFixture()
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-201',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-201',
      status: 'EXECUTING',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
        execution_state: 'RUNNING',
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Receipt with null verifiedAt (unverified submission)
    const unverifiedReceipt: MultiActionReceiptEntry = {
      receiptId: 'rcpt-unverified-1',
      actionFingerprint: 'fp-unverified-1',
      provider: 'instagram',
      verifiedAt: null,
      createdAt: '2026-10-27T10:00:00.000Z',
    }

    const updated = await repo.recordActionReceipt({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-201',
      traceId: 'tr-201',
      expectedSnapshotVersion: 1,
      receipt: unverifiedReceipt,
    })

    // Must be WAITING_EXTERNAL, NOT OBSERVING
    expect(updated.metadata.execution_state).toBe('WAITING_EXTERNAL')
    expect(getStored().metadata.execution_state).toBe('WAITING_EXTERNAL')
    expect(updated.metadata.snapshot_version).toBe(2)
  })

  it('transitions to OBSERVING when receipt is verified and normalizes ledger values', async () => {
    const contract = createValidContractFixture()
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-202',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-202',
      status: 'EXECUTING',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
        execution_state: 'WAITING_EXTERNAL',
        multi_receipts: [],
      },
    })
    const repo = new MissionRepository(mockClient as any)

    // Verified receipt
    const verifiedReceipt: MultiActionReceiptEntry = {
      receiptId: 'rcpt-verified-1',
      receiptKind: 'observed_result',
      observedPayload: { verified: true },
      actionRequestId: 'req-actual-1',
      actionFingerprint: 'fp-verified-1',
      provider: 'instagram',
      verifiedAt: '2026-10-27T10:30:00.000Z',
      createdAt: '2026-10-27T10:00:00.000Z',
    }

    const updated = await repo.recordActionReceipt({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-202',
      traceId: 'tr-202',
      expectedSnapshotVersion: 1,
      receipt: verifiedReceipt,
    })

    expect(updated.metadata.execution_state).toBe('OBSERVING')
    expect(getStored().metadata.execution_state).toBe('OBSERVING')
    const multiReceipts = updated.metadata.multi_receipts as MultiActionReceiptEntry[]
    expect(multiReceipts[0].verifiedAt).toBe('2026-10-27T10:30:00.000Z')
  })

  it('preserves readback and records action receipt into join table even when mission is paused', async () => {
    const contract = createValidContractFixture()
    const { mockClient, getStored, getReceipts } = createMockSupabase({
      id: 'm-200',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-200',
      status: 'PAUSED',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 2,
        execution_state: 'PAUSED',
      },
    })
    const repo = new MissionRepository(mockClient as any)

    const receipt: MultiActionReceiptEntry = {
      receiptId: 'rcpt-provider-ok-1',
      actionFingerprint: 'fp-publish-1',
      provider: 'instagram',
      createdAt: '2026-10-27T10:00:00.000Z',
    }

    const updated = await repo.recordActionReceipt({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-200',
      traceId: 'tr-200',
      expectedSnapshotVersion: 2,
      receipt,
    })

    expect(updated.metadata.snapshot_version).toBe(3)
    expect(updated.metadata.execution_state).toBe('PAUSED')
    expect(getReceipts().length).toBe(1)
    expect(getReceipts()[0].action_receipt_id).toBe('rcpt-provider-ok-1')
    expect(getReceipts()[0].verified_at).toBeNull()
    expect(getStored().external_action_receipt_id).toBe('rcpt-provider-ok-1')
  })

  it('blocks legacy transitionMission on contract-bearing row with CONTRACT_COMMAND_REQUIRED', async () => {
    const contract = createValidContractFixture()
    const { mockClient } = createMockSupabase({
      id: 'm-300',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-300',
      status: 'PAUSED',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
        execution_state: 'PAUSED',
      },
    })
    const repo = new MissionRepository(mockClient as any)

    await expect(
      repo.transitionMission({
        workspaceId: 'ws-tenant-1',
        missionId: 'm-300',
        traceId: 'tr-300',
        toStatus: 'EXECUTING',
        actorType: 'agent',
        eventName: 'EXECUTE_ATTEMPT',
      })
    ).rejects.toThrow('[CONTRACT_COMMAND_REQUIRED]')
  })

  it('blocks legacy updateMissionLineage on contract-bearing row with CONTRACT_COMMAND_REQUIRED', async () => {
    const contract = createValidContractFixture()
    const { mockClient } = createMockSupabase({
      id: 'm-350',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-350',
      status: 'EXECUTING',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
        execution_state: 'RUNNING',
      },
    })
    const repo = new MissionRepository(mockClient as any)

    await expect(
      repo.updateMissionLineage({
        workspaceId: 'ws-tenant-1',
        missionId: 'm-350',
        traceId: 'tr-350',
        actionRequestId: 'req-001',
      })
    ).rejects.toThrow('[CONTRACT_COMMAND_REQUIRED]')
  })

  it('records observation evidence and evaluates outcome state atomically via RPC', async () => {
    const contract = createValidContractFixture()
    const { mockClient, getStored, getEvents } = createMockSupabase({
      id: 'm-400',
      workspace_id: 'ws-tenant-1',
      trace_id: 'tr-400',
      status: 'PUBLISHED_VERIFIED',
      goal: contract.goal,
      metadata: {
        contract,
        snapshot_version: 1,
        execution_state: 'OBSERVING',
        outcome_state: 'PENDING',
      },
    })
    const repo = new MissionRepository(mockClient as any)

    const evidence: ObservationEvidence = {
      status: 'OBSERVED',
      observed_value: 15,
      observed_at: '2026-10-28T12:00:00.000Z',
      source_channel: 'instagram',
    }

    const updated = await repo.recordObservationEvidence({
      workspaceId: 'ws-tenant-1',
      missionId: 'm-400',
      traceId: 'tr-400',
      expectedSnapshotVersion: 1,
      evidence,
      nowIso: '2026-10-29T00:00:00.000Z',
    })

    expect(updated.metadata.snapshot_version).toBe(2)
    expect(updated.metadata.outcome_state).toBe('ACHIEVED_VERIFIED')
    expect(updated.status).toBe('OUTCOME_OBSERVED')
    expect(getStored().metadata.snapshot_version).toBe(2)
    const auditEvent = getEvents().find((e) => e.event_name === 'MISSION_OUTCOME_EVALUATED')
    expect(auditEvent).toBeDefined()
    expect(auditEvent.from_status).toBe('PUBLISHED_VERIFIED')
    expect(auditEvent.to_status).toBe('OUTCOME_OBSERVED')
  })

  it('blocks outcome regression and preserves verified evidence on repeated observations', async () => {
    const evidence = { status: 'OBSERVED', observed_value: 12,
      observed_at: '2026-10-28T00:00:00.000Z', source_channel: 'instagram' }
    const { mockClient, getStored } = createMockSupabase({
      id: 'm-outcome', workspace_id: 'w-1', trace_id: 'tr-1', status: 'OUTCOME_OBSERVED',
      metadata: { contract: createValidContractFixture(), snapshot_version: 1,
        execution_state: 'OBSERVING', outcome_state: 'ACHIEVED_VERIFIED', observation_evidence: evidence },
    })
    const repo = new MissionRepository(mockClient as any)
    await expect(repo.recordObservationEvidence({ workspaceId: 'w-1', missionId: 'm-outcome',
      traceId: 'tr-1', expectedSnapshotVersion: 1, evidence: { status: 'NOT_OBSERVED' },
      nowIso: '2026-10-29T00:00:00.000Z' })).rejects.toThrow('INVALID_OUTCOME_TRANSITION')
    expect(getStored().metadata.observation_evidence).toEqual(evidence)
    await repo.recordObservationEvidence({ workspaceId: 'w-1', missionId: 'm-outcome', traceId: 'tr-1',
      expectedSnapshotVersion: 1, evidence: { ...evidence, status: 'OBSERVED', observed_value: 99 },
      nowIso: '2026-10-29T00:00:00.000Z' })
    expect(getStored().metadata.observation_evidence).toEqual(evidence)
  })

  it.each(['m-1', 'm-other', null])('bindActionRequest handles existing binding %s without overwriting it', async (mission_id) => {
    const eqs: Record<string, unknown> = {}
    const filters: Record<string, unknown> = {}
    const chain: any = {
      eq: vi.fn((key: string, value: unknown) => { eqs[key] = value; return chain }),
      is: vi.fn((key: string, value: unknown) => { filters[key] = value; return chain }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const lookup: any = { eq: vi.fn(() => lookup), maybeSingle: vi.fn().mockResolvedValue({
      data: mission_id === null ? null : { id: 'req-1', mission_id }, error: null,
    }) }
    const update = vi.fn(() => chain)
    const repo = new MissionRepository({ from: vi.fn(() => ({ update, select: vi.fn(() => lookup) })) } as any)
    const result = repo.bindActionRequest('w-1', 'm-1', 'req-1')
    if (mission_id === 'm-1') await expect(result).resolves.toBeUndefined()
    else await expect(result).rejects.toThrow('BIND_ACTION_REQUEST_FAILED')
    expect(update).toHaveBeenCalledWith({ mission_id: 'm-1' })
    expect(eqs).toEqual({ id: 'req-1', workspace_id: 'w-1' })
    expect(filters).toEqual({ mission_id: null })
  })

  it('distinguishes database query error from empty list', async () => {
    const mockErrorClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: async () => ({
                data: null,
                error: { message: 'Database connection failed' },
              }),
            })),
          })),
        })),
      })),
    }

    const repo = new MissionRepository(mockErrorClient as any)
    await expect(repo.listWorkspaceMissions('ws-tenant-1')).rejects.toThrow('[MISSION_LIST_ERROR]')
  })
})

describe('Receipt verification and direct control boundary regressions', () => {
  it.each([
    { verified: true }, { readbackVerified: true },
    { readbackRequestId: 'readback-1' }, { readbackDigest: 'digest-1' },
  ])('accepts canonical observed payload %j without a legacy timestamp', (observedPayload) => {
    expect(isReceiptObservedVerified({ receiptKind: 'observed_result', observedPayload })).toBe(true)
  })

  it.each([
    null, {}, { verified: false, readbackDigest: 'digest' },
    { readbackVerified: false, verified: true }, { verified: 'true' },
    { readbackRequestId: 123 }, { readbackDigest: true }, { readbackRequestId: '  ' },
  ])('rejects noncanonical or explicitly false payload %j despite a timestamp', (observedPayload) => {
    expect(isReceiptObservedVerified({
      receiptKind: 'observed_result', observedPayload,
      verifiedAt: '2026-10-27T10:00:00.000Z', status: 'VERIFIED',
    })).toBe(false)
  })

  it.each(['ACCEPTED_BY_PROVIDER', 'PROCESSING', 'RESULT_UNKNOWN', undefined])(
    'does not treat legacy %s with a timestamp as verified', (status) => {
      expect(isReceiptObservedVerified({ status, verifiedAt: '2026-10-27T10:00:00.000Z' })).toBe(false)
    }
  )
  it('requires explicit VERIFIED for legacy receipts and rejects submission/review', () => {
    expect(isReceiptObservedVerified({ status: 'VERIFIED', verifiedAt: '2026-10-27T10:00:00.000Z' })).toBe(true)
    for (const receiptKind of ['submission', 'provider_review']) {
      expect(isReceiptObservedVerified({ receiptKind, status: 'VERIFIED',
        verifiedAt: '2026-10-27T10:00:00.000Z', observedPayload: { verified: true } })).toBe(false)
    }
  })

  it.each([true, {}, [], '', ' ', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)])(
    'rejects malformed approval fingerprint %j in validator and direct helper', (fingerprint) => {
      const contract = createValidContractFixture({ approval_fingerprint: fingerprint as any })
      expect(() => validateMissionContract(contract)).toThrow('INVALID_MISSION_CONTRACT')
      expect(() => assertControlGateActionAllowed({ executionState: 'RUNNING', contract,
        actionType: 'NEW_WRITE', nowIso: '2026-10-28T00:00:00.000Z' })).toThrow('CONTROL_GATE_UNAPPROVED_CONTRACT')
    }
  )
  it('normalizes a valid approval and permits null/omitted unapproved contracts', () => {
    expect(validateMissionContract(createValidContractFixture({ approval_fingerprint: ` ${'a'.repeat(64)} ` })).approval_fingerprint).toBe('a'.repeat(64))
    expect(validateMissionContract(createValidContractFixture()).approval_fingerprint).toBeNull()
    const { approval_fingerprint, ...withoutFingerprint } = createValidContractFixture()
    expect(validateMissionContract(withoutFingerprint).approval_fingerprint).toBeNull()
  })
  it('blocks at the exact expiry instant while preserving readback/reconciliation', () => {
    const contract = createValidContractFixture({ approval_fingerprint: 'a'.repeat(64) })
    expect(() => assertControlGateActionAllowed({ executionState: 'RUNNING', contract,
      actionType: 'NEW_WRITE', nowIso: '2026-11-04T23:59:59.999Z' })).not.toThrow()
    expect(() => assertControlGateActionAllowed({ executionState: 'RUNNING', contract,
      actionType: 'NEW_WRITE', nowIso: contract.expires_at })).toThrow('CONTROL_GATE_EXPIRED')
    for (const actionType of ['READBACK', 'RECONCILIATION'] as const) {
      expect(() => assertControlGateActionAllowed({ executionState: 'CLOSED', contract,
        actionType, nowIso: contract.expires_at })).not.toThrow()
    }
  })

  it('fails closed when atomic creation RPC is missing without a table-write fallback', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC missing' } }), from: vi.fn() }
    await expect(new MissionRepository(client as any).createMissionWithContract({
      workspaceId: 'w-1', traceId: 'trace', contract: createValidContractFixture(),
    })).rejects.toThrow('MISSION_CREATE_FAILED')
    expect(client.from).not.toHaveBeenCalled()
  })
})

describe('Canonical Projection DTO & Snapshot', () => {
  const contract = createValidContractFixture()
  const baseAggregate: MarketingMissionAggregate = {
    id: 'm-abc-123',
    workspace_id: 'ws-beauty-01',
    trace_id: 'tr-999',
    status: 'PUBLISHED_VERIFIED',
    goal: contract.goal,
    target_channel: 'instagram',
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T01:00:00.000Z',
    metadata: {
      contract,
      snapshot_version: 3,
      execution_state: 'OBSERVING',
      outcome_state: 'PENDING',
    },
  }

  it('builds canonical projection DTO without exposing raw metadata or internal UUIDs in copy', () => {
    const dto = buildCanonicalMissionDTO(baseAggregate)
    expect(dto.snapshotVersion).toBe(3)
    expect(dto.executionState).toBe('OBSERVING')
    expect(dto.outcomeState).toBe('PENDING')
    // Honest copy without fake real-time observation claims when evidence is unobserved
    expect(dto.userCopy).toContain('성과 지표 관측 대기 중')
    expect(dto.userCopy).not.toContain('실시간 관측 중')
    expect(dto.nextCheckAt).toBeDefined()
    expect(dto.observationStatus).toBe('NOT_OBSERVED') // Fallback
  })

  it('reflects observation progress copy when real observations are registered in OBSERVING state', () => {
    const observedAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      metadata: {
        ...baseAggregate.metadata,
        observation_evidence: {
          status: 'OBSERVED',
          observed_value: 5,
          observed_at: '2026-10-28T00:00:00.000Z',
          source_channel: 'instagram',
        },
      },
    }
    const dto = buildCanonicalMissionDTO(observedAggregate)
    expect(dto.observationStatus).toBe('OBSERVED')
    expect(dto.observedValue).toBe(5)
    expect(dto.userCopy).toContain('성과 지표 관측 진행 중')
  })

  it('builds durable snapshot projection across devices', () => {
    const snapshot = buildCanonicalMissionSnapshot(baseAggregate)
    expect(snapshot.snapshotVersion).toBe('snap-v3-m-abc-12-1793062800000')
    expect(snapshot.canonicalStatus).toBe('PUBLISHED_VERIFIED')
    expect(snapshot.canonicalDto.executionState).toBe('OBSERVING')
  })

  it('filters nextAllowedActions when mission is paused or pausing', () => {
    const pausedAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      status: 'PAUSED',
      metadata: {
        ...baseAggregate.metadata,
        execution_state: 'PAUSED',
      },
    }
    const agentContext = buildAgentMissionContext(pausedAggregate)
    expect(agentContext.nextAllowedActions).toEqual(['RESUME_MISSION', 'READBACK_EXTERNAL', 'RECONCILE_ACCOUNTS'])
    expect(agentContext.nextAllowedActions).not.toContain('PRODUCE_CONTENT')
    expect(agentContext.nextAllowedActions).not.toContain('EXECUTE_PUBLISH')

    const pausingAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      metadata: {
        ...baseAggregate.metadata,
        execution_state: 'PAUSING',
      },
    }
    const pausingContext = buildAgentMissionContext(pausingAggregate)
    expect(pausingContext.nextAllowedActions).toEqual(['RESUME_MISSION', 'READBACK_EXTERNAL', 'RECONCILE_ACCOUNTS'])
    expect(pausingContext.nextAllowedActions).not.toContain('EXECUTE_PUBLISH')
  })
})
